-- Bergkoenig — POIs: Scharten, Huetten, Aussichtspunkte, Seen, Gletscher, etc.
-- Bonuspunkte bei GPS-Naehe, KEINE Kronen, KEINE Lose

CREATE TABLE pois (
  id         BIGINT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_de    TEXT,
  type       TEXT NOT NULL CHECK(type IN ('saddle','hut','viewpoint','lake','glacier','via_ferrata','cave','waterfall','chapel','pass')),
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  elevation  INTEGER,
  osm_region TEXT,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pois_type_idx ON pois(type);
CREATE INDEX pois_lat_lng_idx ON pois(lat, lng);

ALTER TABLE pois ENABLE ROW LEVEL SECURITY;
CREATE POLICY "POIs oeffentlich" ON pois FOR SELECT USING (true);
CREATE POLICY "Service inserts pois" ON pois FOR INSERT WITH CHECK (true);

-- POI-Besuche tracken
CREATE TABLE poi_visits (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  poi_id            BIGINT REFERENCES pois(id),
  poi_type          TEXT NOT NULL,
  visited_at        TIMESTAMPTZ NOT NULL,
  season            TEXT NOT NULL,
  strava_activity_id TEXT,
  bonus_points      INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX poi_visits_user_idx ON poi_visits(user_id, season);
CREATE INDEX poi_visits_poi_idx ON poi_visits(poi_id);

ALTER TABLE poi_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eigene POI-Visits lesen" ON poi_visits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "POI-Visits updaten" ON poi_visits FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service inserts poi_visits" ON poi_visits FOR INSERT WITH CHECK (true);
