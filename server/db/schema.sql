CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS barrier_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  location_label TEXT NOT NULL CHECK (length(location_label) BETWEEN 1 AND 500),
  geom geometry(Point, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS barrier_reports_geom_gix ON barrier_reports USING GIST (geom);
CREATE INDEX IF NOT EXISTS barrier_reports_geography_gix ON barrier_reports USING GIST ((geom::geography));
CREATE INDEX IF NOT EXISTS barrier_reports_created_at_idx ON barrier_reports (created_at DESC);

-- Route geometries are stored in WGS84 with XYZ coordinates (longitude, latitude, elevation).
CREATE TABLE IF NOT EXISTS saved_routes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label TEXT NOT NULL,
  geom geometry(LineStringZ, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_routes_geom_gix ON saved_routes USING GIST (geom);
