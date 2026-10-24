/* PATH PROOFS — India-focused map, external pedestrian routing, PostGIS reports. */
const map = L.map("map", { minZoom: 4 }).setView([22.9734, 78.6569], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap contributors</a>", maxZoom: 19
}).addTo(map);
map.setMaxBounds(L.latLngBounds([6, 67], [38, 98]).pad(0.1));
const routeLayer = L.layerGroup().addTo(map);
const barrierLayer = L.layerGroup().addTo(map);
let routeCandidates = [];
let selectedRouteIndex = 0;
const $ = id => document.getElementById(id);
const startInput = $("start"), destinationInput = $("destination"), profileSelect = $("profile"), profileMessage = $("profileMessage");
const routeButton = $("routeButton"), routeStatus = $("result"), routeResults = $("routeResults");
const barrierForm = $("barrierForm"), barrierTypeInput = $("barrier"), barrierLocationInput = $("location"), reportButton = $("reportButton"), reportResult = $("reportResult"), reportList = $("reportList");
const profileDescriptions = {
    wheelchair: "Wheelchair profile selected. This walking route is not checked for step-free access, ramps or pavement conditions.",
    blind: "Blind / Low Vision profile selected. The route service does not provide validated audio guidance or safe-crossing data.",
    elderly: "Elderly pedestrian profile selected. Route conditions and resting places are not verified.",
    general: "General pedestrian profile selected. Verify route conditions before travelling."
};
function updateProfile() { if (profileSelect && profileMessage) profileMessage.textContent = profileDescriptions[profileSelect.value] || profileDescriptions.general; }
profileSelect?.addEventListener("change", updateProfile); updateProfile();
async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
}
async function findCoordinates(place) { return api(`/api/geocode?q=${encodeURIComponent(place)}`); }
function formatDistance(metres) { return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`; }
function formatDuration(seconds) { const minutes = Math.round(seconds / 60); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`; }
function drawRouteCandidates() {
    routeLayer.clearLayers();
    routeCandidates.forEach((candidate, index) => {
        const selected = index === selectedRouteIndex;
        L.geoJSON(candidate.geometry, { style: { color: selected ? "#14B8A6" : "#8B8B95", weight: selected ? 7 : 4, opacity: selected ? 1 : 0.75 } }).addTo(routeLayer)
            .bindPopup(`<strong>${selected ? "Selected route" : "Alternative route"}</strong><br>Distance: ${formatDistance(candidate.distance)}<br>Estimated time: ${formatDuration(candidate.duration)}<br>Nearby unverified community reports: ${candidate.nearbyBarriers.length}`);
    });
    if (routeCandidates.length) map.fitBounds(routeLayer.getBounds(), { padding: [35, 35], maxZoom: 15 });
}
function showRouteResults() {
    routeResults.replaceChildren();
    const heading = document.createElement("h3"); heading.textContent = "Walking route options"; routeResults.appendChild(heading);
    const note = document.createElement("p"); note.className = "route-comparison-note"; note.textContent = "Routes are supplied by an OpenStreetMap-based foot routing service. They are not accessibility-verified."; routeResults.appendChild(note);
    routeCandidates.forEach((candidate, index) => {
        const selected = index === selectedRouteIndex;
        const card = document.createElement("article"); card.className = selected ? "route-card selected-route" : "route-card alternative-route";
        const title = document.createElement("h4"); title.textContent = `Route ${index + 1}${selected ? " — Selected" : ""}`;
        const details = document.createElement("p"); details.textContent = `Distance: ${formatDistance(candidate.distance)} · Estimated time: ${formatDuration(candidate.duration)}`;
        const warning = document.createElement("p");
        warning.textContent = candidate.nearbyBarriers.length ? `${candidate.nearbyBarriers.length} nearby unverified community barrier report(s).` : "No reports in the database near this route. This does not mean the route is accessible.";
        const button = document.createElement("button"); button.type = "button"; button.textContent = selected ? "Currently selected" : "Select this route"; button.disabled = selected;
        button.addEventListener("click", () => { selectedRouteIndex = index; drawRouteCandidates(); showRouteResults(); });
        card.append(title, details, warning, button); routeResults.appendChild(card);
    });
}
async function handleFindRoute() {
    const startPlace = startInput.value.trim(), endPlace = destinationInput.value.trim();
    if (!startPlace || !endPlace) { routeStatus.textContent = "Enter both a starting point and a destination."; return; }
    routeButton.disabled = true; routeButton.textContent = "Finding route…"; routeStatus.textContent = "Finding locations and requesting walking routes…"; routeResults.replaceChildren();
    try {
        const [start, end] = await Promise.all([findCoordinates(startPlace), findCoordinates(endPlace)]);
        const params = new URLSearchParams({ startLat: start.latitude, startLon: start.longitude, endLat: end.latitude, endLon: end.longitude });
        const result = await api(`/api/routes?${params}`);
        routeCandidates = result.routes; selectedRouteIndex = 0; drawRouteCandidates(); showRouteResults();
        routeStatus.textContent = "Walking route options loaded. Confirm real-world conditions and accessibility before travelling.";
    } catch (error) { routeStatus.textContent = `Could not find a route: ${error.message}`; }
    finally { routeButton.disabled = false; routeButton.textContent = "Find accessible route →"; }
}
routeButton?.addEventListener("click", handleFindRoute);
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function renderBarrierList(reports) {
    reportList.replaceChildren();
    if (!reports.length) { const empty = document.createElement("p"); empty.textContent = "No community reports in the current map view."; reportList.appendChild(empty); return; }
    reports.forEach(report => {
        const card = document.createElement("article"); card.className = "route-card";
        const title = document.createElement("h4"); title.textContent = report.category;
        const location = document.createElement("p"); location.textContent = `Location: ${report.location}`;
        const status = document.createElement("p"); status.textContent = report.verified ? "Verified report" : "Community report — not verified";
        card.append(title, location, status); reportList.appendChild(card);
    });
}
async function refreshBarriers() {
    const bounds = map.getBounds(), bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",");
    try {
        const reports = await api(`/api/barriers?bbox=${encodeURIComponent(bbox)}`); barrierLayer.clearLayers();
        reports.forEach(report => L.marker([report.latitude, report.longitude]).addTo(barrierLayer).bindPopup(`<strong>${escapeHtml(report.category)}</strong><br>Location: ${escapeHtml(report.location)}<br>Community report — not verified`));
        renderBarrierList(reports);
    } catch (error) { reportList.textContent = `Barrier reports unavailable: ${error.message}`; }
}
let refreshTimer;
map.on("moveend", () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshBarriers, 250); });
refreshBarriers();
barrierForm?.addEventListener("submit", async event => {
    event.preventDefault(); const location = barrierLocationInput.value.trim();
    if (!location) { reportResult.textContent = "Enter a location for the report."; return; }
    reportButton.disabled = true; reportButton.textContent = "Submitting…"; reportResult.textContent = "Resolving the reported location…";
    try {
        const coords = await findCoordinates(location);
        const report = await api("/api/barriers", { method: "POST", body: JSON.stringify({ category: barrierTypeInput.value, location, latitude: coords.latitude, longitude: coords.longitude }) });
        reportResult.textContent = "Report saved. It is a community submission and has not been verified."; barrierForm.reset(); map.setView([report.latitude, report.longitude], 16); await refreshBarriers();
    } catch (error) { reportResult.textContent = `Report could not be submitted: ${error.message}`; }
    finally { reportButton.disabled = false; reportButton.textContent = "Submit barrier report"; }
});
console.log("PATH PROOFS initialized.");
