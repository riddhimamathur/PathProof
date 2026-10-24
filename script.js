
/* =========================================
   OmniRoute — Accessible Navigation for India
   Route comparison + barrier reporting
   ========================================= */

const map = L.map("map").setView([22.9734, 78.6569], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);
const barrierLayer = L.layerGroup().addTo(map);

const activeBarriers = [];
let routeCandidates = [];
let selectedRouteIndex = 0;

const $ = id => document.getElementById(id);

const startInput = $("start");
const destinationInput = $("destination");
const profileSelect = $("profile");
const profileMessage = $("profileMessage");
const routeButton = $("routeButton");
const routeStatus = $("result");
const routeResults = $("routeResults");

const confidenceButton = $("confidenceButton");
const confidenceScore = $("confidenceScore");
const outdatedSegments = $("outdatedSegments");
const confidenceMessage = $("confidenceMessage");
const confidenceResult = $("confidenceResult");

const barrierForm = $("barrierForm");
const barrierTypeInput = $("barrier");
const barrierLocationInput = $("location");
const barrierPhotoInput = $("barrierPhoto");
const reportButton = $("reportButton");
const reportResult = $("reportResult");
const reportList = $("reportList");

/* Sample cities */

[
    { name: "New Delhi", coords: [28.6139, 77.2090] },
    { name: "Mumbai", coords: [19.0760, 72.8777] },
    { name: "Bengaluru", coords: [12.9716, 77.5946] }
].forEach(city => {
    L.marker(city.coords)
        .addTo(map)
        .bindPopup("<strong>" + city.name + "</strong><br>Sample city marker");
});

/* Accessibility profiles */

const profileDescriptions = {
    wheelchair: "Wheelchair profile selected. Check step-free access, ramps, kerbs and pavement conditions.",
    blind: "Blind / Low Vision profile selected. Audio guidance and safe crossings should be checked.",
    elderly: "Elderly pedestrian profile selected. Check crossings, pavement quality and resting places.",
    general: "General pedestrian profile selected. Check route conditions before travelling."
};

function updateProfile() {
    if (profileSelect && profileMessage) {
        profileMessage.textContent =
            profileDescriptions[profileSelect.value] ||
            profileDescriptions.general;
    }
}

profileSelect?.addEventListener("change", updateProfile);
updateProfile();

/* Find locations in India */

async function findCoordinates(place) {
    const url = new URL("https://nominatim.openstreetmap.org/search");

    url.search = new URLSearchParams({
        q: place + ", India",
        format: "jsonv2",
        limit: "1",
        countrycodes: "in"
    });

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Location search failed. Check your internet connection and try again.");
    }

    const results = await response.json();

    if (!results.length) {
        throw new Error('Location "' + place + '" was not found in India. Try a more specific name.');
    }

    return [Number(results[0].lat), Number(results[0].lon)];
}

/* Distance between a point and a route segment */

function distancePointToSegmentMetres(point, start, end) {
    const latitude = point[0] * Math.PI / 180;
    const metresPerDegreeLat = 111320;
    const metresPerDegreeLon = 111320 * Math.cos(latitude);

    const px = point[1] * metresPerDegreeLon;
    const py = point[0] * metresPerDegreeLat;
    const ax = start[1] * metresPerDegreeLon;
    const ay = start[0] * metresPerDegreeLat;
    const bx = end[1] * metresPerDegreeLon;
    const by = end[0] * metresPerDegreeLat;

    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);

    const t = Math.max(0, Math.min(1,
        ((px - ax) * dx + (py - ay) * dy) / lengthSquared
    ));

    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function findNearbyBarriers(coordinates, thresholdMetres = 30) {
    return activeBarriers.filter(barrier => {
        for (let i = 0; i < coordinates.length - 1; i++) {
            if (distancePointToSegmentMetres(
                barrier.coords,
                coordinates[i],
                coordinates[i + 1]
            ) <= thresholdMetres) {
                return true;
            }
        }
        return false;
    });
}

/* Request route alternatives.
   Note: the public service uses a driving-profile endpoint,
   so results must not be treated as validated pedestrian routes. */

async function requestAlternativeRoutes(startCoords, endCoords) {
    const start = startCoords[1] + "," + startCoords[0];
    const end = endCoords[1] + "," + endCoords[0];

    const url =
        "https://routing.openstreetmap.de/routed-foot/route/v1/driving/" +
        start + ";" + end +
        "?alternatives=3&overview=full&geometries=geojson";

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Routing service returned HTTP " + response.status + ". Please try again later.");
    }

    const data = await response.json();

    if (data.code !== "Ok" || !Array.isArray(data.routes) || !data.routes.length) {
        throw new Error(data.message || "No route was found for these locations.");
    }

    return data.routes;
}

/* Prepare route candidates */

function prepareRouteCandidates(routes) {
    return routes.map(route => {
        const coordinates = route.geometry.coordinates.map(
            ([longitude, latitude]) => [latitude, longitude]
        );

        const barriers = findNearbyBarriers(coordinates);

        return {
            coordinates,
            distance: route.distance,
            duration: route.duration,
            barriers,
            barrierCount: barriers.length
        };
    }).sort((a, b) =>
        a.barrierCount - b.barrierCount || a.distance - b.distance
    );
}

function formatDistance(metres) {
    return metres >= 1000
        ? (metres / 1000).toFixed(2) + " km"
        : Math.round(metres) + " m";
}

function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);

    return minutes < 60
        ? minutes + " min"
        : Math.floor(minutes / 60) + " hr " + (minutes % 60) + " min";
}

/* Draw selected route in teal and alternatives in grey */

function drawRouteCandidates() {
    routeLayer.clearLayers();

    routeCandidates.forEach((candidate, index) => {
        const selected = index === selectedRouteIndex;

        const line = L.polyline(candidate.coordinates, {
            color: selected ? "#14B8A6" : "#8B8B95",
            weight: selected ? 7 : 4,
            opacity: selected ? 1 : 0.75,
            lineCap: "round",
            lineJoin: "round"
        }).addTo(routeLayer);

        line.bindPopup(
            "<strong>" + (selected ? "Selected route" : "Alternative route") +
            "</strong><br>Route " + (index + 1) +
            "<br>Distance: " + formatDistance(candidate.distance) +
            "<br>Estimated time: " + formatDuration(candidate.duration) +
            "<br>Nearby unverified barrier reports: " + candidate.barrierCount
        );

        if (selected) line.bringToFront();
    });

    if (routeCandidates.length) {
        map.fitBounds(
            L.latLngBounds(routeCandidates[selectedRouteIndex].coordinates),
            { padding: [35, 35] }
        );
    }
}

/* Display comparison cards */

function showRouteResults() {
    if (!routeResults) return;

    routeResults.replaceChildren();

    const heading = document.createElement("h3");
    heading.textContent = "Compare your routes";
    routeResults.appendChild(heading);

    const note = document.createElement("p");
    note.className = "route-comparison-note";
    note.textContent = "Teal = selected route. Grey = alternatives. Nearby barrier reports are unverified.";
    routeResults.appendChild(note);

    if (routeCandidates.length === 1) {
        const warning = document.createElement("p");
        warning.textContent = "Only one route was returned. Alternative routes are not guaranteed.";
        routeResults.appendChild(warning);
    }

    routeCandidates.forEach((candidate, index) => {
        const selected = index === selectedRouteIndex;
        const card = document.createElement("article");

        card.className = selected
            ? "route-card selected-route"
            : "route-card alternative-route";

        const title = document.createElement("h4");
        title.textContent = "Route " + (index + 1) + (selected ? " — Selected" : "");

        const badge = document.createElement("span");
        badge.className = selected
            ? "route-badge selected-badge"
            : "route-badge alternative-badge";
        badge.textContent = selected ? "SELECTED" : "ALTERNATIVE";

        const details = document.createElement("p");
        details.className = "route-details";
        details.textContent =
            "Distance: " + formatDistance(candidate.distance) +
            " · Estimated time: " + formatDuration(candidate.duration);

        const barrierInfo = document.createElement("p");
        barrierInfo.className = candidate.barrierCount
            ? "route-barrier-warning"
            : "route-barrier-info";
        barrierInfo.textContent = candidate.barrierCount
            ? "Warning: " + candidate.barrierCount +
              " nearby unverified barrier report(s). Check conditions."
            : "No nearby reports found. Accessibility is not guaranteed.";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-select-button";
        button.textContent = selected ? "Currently selected" : "Select this route";
        button.disabled = selected;
        button.setAttribute("aria-pressed", String(selected));

        button.addEventListener("click", () => {
            selectedRouteIndex = index;
            drawRouteCandidates();
            showRouteResults();
        });

        card.append(title, badge, details, barrierInfo, button);
        routeResults.appendChild(card);
    });
}

/* Find route */

async function handleFindRoute() {
    const startPlace = startInput.value.trim();
    const endPlace = destinationInput.value.trim();

    if (!startPlace || !endPlace) {
        routeStatus.textContent = "Please enter both a starting point and a destination.";
        return;
    }

    routeButton.disabled = true;
    routeButton.textContent = "Finding route...";
    routeStatus.textContent = "Searching for locations and routes...";
    routeResults?.replaceChildren();

    try {
        const [startCoords, endCoords] = await Promise.all([
            findCoordinates(startPlace),
            findCoordinates(endPlace)
        ]);

        const routes = await requestAlternativeRoutes(startCoords, endCoords);

        routeCandidates = prepareRouteCandidates(routes);
        selectedRouteIndex = 0;

        drawRouteCandidates();
        showRouteResults();

        routeStatus.textContent =
            "Routes found. Review the alternatives and verify conditions before travelling.";
    } catch (error) {
        console.error("Route error:", error);
        routeStatus.textContent = "Could not find route: " + error.message;
    } finally {
        routeButton.disabled = false;
        routeButton.textContent = "Find accessible route →";
    }
}

routeButton?.addEventListener("click", handleFindRoute);

/* Demonstration confidence indicators */

function updateConfidence() {
    const totalSegments = 20;
    const segmentsWithRecentImagery = 16;
    const withoutRecentImagery = totalSegments - segmentsWithRecentImagery;
    const demonstrationConfidence = Math.round(
        (segmentsWithRecentImagery / totalSegments) * 80
    );

    if (confidenceScore) confidenceScore.textContent = demonstrationConfidence + "%";
    if (outdatedSegments) outdatedSegments.textContent = withoutRecentImagery + " / " + totalSegments;

    if (confidenceMessage) {
        confidenceMessage.textContent =
            "Illustrative demo: " + segmentsWithRecentImagery + " of " +
            totalSegments + " segments have assumed recent imagery. These are not live measurements.";
    }

    if (confidenceResult) {
        confidenceResult.textContent =
            "Demonstration confidence: " + demonstrationConfidence +
            "%. This is not a validated accessibility score.";
    }
}

confidenceButton?.addEventListener("click", updateConfidence);
updateConfidence();

/* Escape text before placing it in map popups */

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

/* Barrier report list */

function renderBarrierList() {
    if (!reportList) return;

    reportList.replaceChildren();

    if (!activeBarriers.length) {
        const message = document.createElement("p");
        message.textContent = "No barrier reports submitted yet.";
        reportList.appendChild(message);
        return;
    }

    activeBarriers.forEach((report, index) => {
        const card = document.createElement("article");
        card.className = "route-card";

        const title = document.createElement("h4");
        title.textContent = report.description;

        const location = document.createElement("p");
        location.textContent = "Location: " + report.location;

        const status = document.createElement("p");
        status.textContent = "Community report — not verified";

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.textContent = "Remove report";

        removeButton.addEventListener("click", () => {
            activeBarriers.splice(index, 1);
            renderBarrierMarkers();
            renderBarrierList();
            refreshRouteBarrierCounts();

            if (reportResult) {
                reportResult.textContent = "Report removed from this browser session.";
            }
        });

        card.append(title, location, status, removeButton);
        reportList.appendChild(card);
    });
}

/* Draw barrier markers */

function renderBarrierMarkers() {
    barrierLayer.clearLayers();

    activeBarriers.forEach(report => {
        L.marker(report.coords)
            .addTo(barrierLayer)
            .bindPopup(
                "<strong>" + escapeHtml(report.description) + "</strong><br>" +
                "Location: " + escapeHtml(report.location) +
                "<br>Community report — not verified"
            );
    });
}

/* Refresh route counts after reports change */

function refreshRouteBarrierCounts() {
    routeCandidates = routeCandidates.map(candidate => {
        const barriers = findNearbyBarriers(candidate.coordinates);
        return { ...candidate, barriers, barrierCount: barriers.length };
    });

    if (routeCandidates.length) {
        drawRouteCandidates();
        showRouteResults();
    }
}

/* Submit a community barrier report */

barrierForm?.addEventListener("submit", async event => {
    event.preventDefault();

    const location = barrierLocationInput.value.trim();
    const barrierType = barrierTypeInput.value;

    if (!location || !barrierType) {
        reportResult.textContent = "Please select a barrier type and enter a location.";
        return;
    }

    reportButton.disabled = true;
    reportButton.textContent = "Submitting...";
    reportResult.textContent = "Finding the reported location...";

    try {
        const coords = await findCoordinates(location);

        activeBarriers.push({
            description: barrierType,
            location,
            coords,
            createdAt: Date.now()
        });

        renderBarrierMarkers();
        renderBarrierList();
        refreshRouteBarrierCounts();

        map.setView(coords, 16);

        reportResult.textContent =
            "Report added to this browser session. It is not verified or shared with other users.";

        barrierForm.reset();
        if (barrierPhotoInput) barrierPhotoInput.value = "";
    } catch (error) {
        console.error("Barrier report error:", error);
        reportResult.textContent = "Report could not be submitted: " + error.message;
    } finally {
        reportButton.disabled = false;
        reportButton.textContent = "Submit barrier report";
    }
});

/* Expire reports after one hour */

setInterval(() => {
    const now = Date.now();
    const previousCount = activeBarriers.length;

    for (let i = activeBarriers.length - 1; i >= 0; i--) {
        if (now - activeBarriers[i].createdAt >= 60 * 60 * 1000) {
            activeBarriers.splice(i, 1);
        }
    }

    if (activeBarriers.length !== previousCount) {
        renderBarrierMarkers();
        renderBarrierList();
        refreshRouteBarrierCounts();

        if (reportResult) reportResult.textContent = "Expired reports have been removed.";
    }
}, 60 * 1000);

renderBarrierList();

console.log("PATH PROOFS initialized successfully.");
