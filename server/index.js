require('dotenv').config();
const express = require('express');
const path = require('node:path');
const { pool } = require('./db/pool');
const { listNearbyBarriers, createBarrier, barriersNearLine } = require('./db/spatial');

const app = express();
const port = Number(process.env.PORT || 3000);
const indiaBounds = { west: 67, south: 6, east: 98, north: 38 };
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..')));

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT PostGIS_Version()'); res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'unavailable', database: 'unavailable' }); }
});

app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length > 200) return res.status(400).json({ error: 'A location query of 1–200 characters is required.' });
  try {
    const endpoint = new URL('/search', process.env.GEOCODING_BASE_URL || 'https://nominatim.openstreetmap.org');
    endpoint.search = new URLSearchParams({ q: `${q}, India`, format: 'jsonv2', limit: '1', countrycodes: 'in', viewbox: `${indiaBounds.west},${indiaBounds.north},${indiaBounds.east},${indiaBounds.south}`, bounded: '1' });
    const response = await fetch(endpoint, { headers: { 'User-Agent': 'PathProof/1.0 (accessible route discovery)' }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Geocoding provider unavailable');
    const results = await response.json();
    if (!results.length) return res.status(404).json({ error: 'Location not found in India. Try a more specific name.' });
    res.json({ latitude: Number(results[0].lat), longitude: Number(results[0].lon), label: results[0].display_name });
  } catch (error) { res.status(502).json({ error: error.message || 'Geocoding service unavailable.' }); }
});

app.get('/api/routes', async (req, res) => {
  const values = ['startLat', 'startLon', 'endLat', 'endLon'].map(key => Number(req.query[key]));
  if (values.some(value => !Number.isFinite(value)) || values[0] < 6 || values[0] > 38 || values[2] < 6 || values[2] > 38 || values[1] < 67 || values[1] > 98 || values[3] < 67 || values[3] > 98) return res.status(400).json({ error: 'Valid start and end coordinates within India are required.' });
  const [startLat, startLon, endLat, endLon] = values;
  const base = (process.env.ROUTING_BASE_URL || 'https://routing.openstreetmap.de/routed-foot').replace(/\/$/, '');
  try {
    const url = `${base}/route/v1/foot/${startLon},${startLat};${endLon},${endLat}?alternatives=3&overview=full&geometries=geojson`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Routing provider returned HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== 'Ok' || !Array.isArray(data.routes) || !data.routes.length) return res.status(404).json({ error: data.message || 'No walking route was found.' });
    const routes = await Promise.all(data.routes.map(async route => ({ ...route, nearbyBarriers: await barriersNearLine(route.geometry.coordinates) })));
    res.json({ provider: 'OpenStreetMap routing service (foot profile)', accessibilityVerified: false, routes });
  } catch (error) { res.status(502).json({ error: error.message || 'Routing service unavailable.' }); }
});

app.get('/api/barriers', async (req, res) => {
  const bbox = String(req.query.bbox || '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some(value => !Number.isFinite(value)) || bbox[0] < 67 || bbox[2] > 98 || bbox[1] < 6 || bbox[3] > 38 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return res.status(400).json({ error: 'bbox must be west,south,east,north within India.' });
  try { res.json(await listNearbyBarriers({ west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] })); }
  catch { res.status(503).json({ error: 'Barrier data is unavailable.' }); }
});

app.post('/api/barriers', async (req, res) => {
  const { category, description = '', location, latitude, longitude } = req.body || {};
  if (typeof category !== 'string' || !category.trim() || category.length > 120 || typeof location !== 'string' || !location.trim() || location.length > 500 || typeof description !== 'string' || description.length > 2000 || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 6 || latitude > 38 || longitude < 67 || longitude > 98) return res.status(400).json({ error: 'A category, location, and valid coordinates within India are required.' });
  try { res.status(201).json(await createBarrier({ category: category.trim(), description: description.trim(), location: location.trim(), latitude, longitude })); }
  catch { res.status(503).json({ error: 'Could not save the barrier report.' }); }
});

app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Internal server error.' }); });
const server = app.listen(port, () => console.log(`PathProof listening on port ${port}`));
async function shutdown() { server.close(); await pool.end(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
