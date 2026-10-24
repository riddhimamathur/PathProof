const { pool } = require('./pool');

async function listNearbyBarriers({ west, south, east, north }) {
  const { rows } = await pool.query(
    `SELECT id, category, description, location_label AS location,
            ST_Y(geom) AS latitude, ST_X(geom) AS longitude,
            created_at, verified
       FROM barrier_reports
      WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      ORDER BY created_at DESC LIMIT 500`,
    [west, south, east, north]
  );
  return rows;
}

async function createBarrier({ category, description, location, latitude, longitude }) {
  const { rows } = await pool.query(
    `INSERT INTO barrier_reports (category, description, location_label, geom)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
     RETURNING id, category, description, location_label AS location,
               ST_Y(geom) AS latitude, ST_X(geom) AS longitude, created_at, verified`,
    [category, description || '', location, longitude, latitude]
  );
  return rows[0];
}

async function barriersNearLine(coordinates, bufferMetres = 30) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
  const line = JSON.stringify({ type: 'LineString', coordinates });
  const { rows } = await pool.query(
    `WITH route AS (
       SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography AS geom
     )
     SELECT b.id, b.category, b.location_label AS location,
            ST_Distance(b.geom::geography, route.geom) AS distance_metres
       FROM barrier_reports b CROSS JOIN route
       WHERE ST_DWithin(b.geom::geography, route.geom, $2)
       ORDER BY distance_metres`,
    [line, bufferMetres]
  );
  return rows;
}

module.exports = { listNearbyBarriers, createBarrier, barriersNearLine };
