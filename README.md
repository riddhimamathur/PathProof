# PathProof

India-focused accessible route discovery prototype with Leaflet, OpenStreetMap tiles, an Express API, and PostgreSQL/PostGIS-backed community barrier reports.

## Run locally

1. Install Node.js 20+ and PostgreSQL with PostGIS.
2. Create a database, enable PostGIS, and apply the schema: `psql "$DATABASE_URL" -f server/db/schema.sql` (the schema also enables the extension).
3. Copy `.env.example` to `.env`, set `DATABASE_URL`, then run `npm install` and `npm start`.
4. Open `http://localhost:3000`.

The map uses the public OpenStreetMap raster tile service. Location lookup uses Nominatim and walking routes use the OpenStreetMap-based `routed-foot` OSRM service. Public community routing/geocoding endpoints are demonstration integrations, subject to provider usage policies and availability; production deployments should use contracted or self-hosted providers. Routes are not accessibility-verified. Configure a Mapbox token only if replacing OSM tiles with a Mapbox client; never put a secret server-side credential in source control.

`server/db/schema.sql` stores route geometry as `geometry(LineStringZ, 4326)` and community reports as `geometry(Point, 4326)`, with GiST indexes and parameterized spatial bounding/near-route queries. No mock route, tile, barrier, or confidence data is included.
