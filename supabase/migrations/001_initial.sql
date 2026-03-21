-- Gipfelkönig — Vollständiges Datenbankschema
-- PostGIS für Gipfelerkennung (80m Radius)

-- Extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- PEAKS: Gipfel aus OpenStreetMap
CREATE TABLE peaks (
  id            BIGINT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_de       TEXT,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  elevation     INTEGER,
  osm_region    TEXT DEFAULT 'AT-08',
  season_from   TEXT DEFAULT '06-01',
  season_to     TEXT DEFAULT '10-31',
  difficulty    TEXT DEFAULT 'T2',
  is_active     BOOLEAN DEFAULT true,
  geom          GEOMETRY(Point, 4326),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX peaks_geom_idx ON peaks USING GIST(geom);
CREATE INDEX peaks_region_idx ON peaks(osm_region);

-- SAFETY_STATUS: Täglich von ALBINA aktualisiert
CREATE TABLE safety_status (
  region_id     TEXT NOT NULL,
  date          DATE NOT NULL,
  danger_level  INTEGER CHECK(danger_level BETWEEN 1 AND 5),
  is_safe       BOOLEAN GENERATED ALWAYS AS (danger_level <= 2) STORED,
  bulletin_url  TEXT,
  raw_data      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (region_id, date)
);

-- USERS: Erweitert Supabase Auth
CREATE TABLE user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id),
  username      TEXT UNIQUE,
  display_name  TEXT,
  avatar_url    TEXT,
  strava_id     TEXT,
  strava_token  TEXT,
  strava_refresh_token TEXT,
  strava_token_expires_at TIMESTAMPTZ,
  home_region   TEXT DEFAULT 'AT-08',
  total_points  INTEGER DEFAULT 0,
  push_subscription JSONB,
  telegram_chat_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- SUMMITS: Jede einzelne Gipfelbesteigung
CREATE TABLE summits (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  peak_id         BIGINT REFERENCES peaks(id),
  summited_at     TIMESTAMPTZ NOT NULL,
  season          TEXT NOT NULL,
  strava_activity_id TEXT,
  checkin_method  TEXT CHECK(checkin_method IN ('strava', 'manual')) DEFAULT 'strava',
  points          INTEGER DEFAULT 0,
  is_season_first BOOLEAN DEFAULT false,
  is_personal_first BOOLEAN DEFAULT false,
  safety_ok       BOOLEAN DEFAULT true,
  safety_level    INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX summits_user_idx ON summits(user_id);
CREATE INDEX summits_peak_idx ON summits(peak_id);
CREATE INDEX summits_season_idx ON summits(season);

-- OWNERSHIP: Wer ist aktuell Gipfelkönig?
CREATE TABLE ownership (
  peak_id         BIGINT REFERENCES peaks(id),
  season          TEXT NOT NULL,
  user_id         UUID REFERENCES user_profiles(id),
  summit_count    INTEGER DEFAULT 1,
  king_since      TIMESTAMPTZ DEFAULT NOW(),
  last_summited   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (peak_id, season)
);

-- BADGES: Dauerhafte Trophäen
CREATE TABLE badges (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES user_profiles(id),
  peak_id         BIGINT REFERENCES peaks(id),
  season          TEXT,
  badge_type      TEXT CHECK(badge_type IN ('king_end', 'pioneer', 'rare', 'combo', 'streak', 'early_bird', 'sunset', 'night_owl')),
  awarded_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS aktivieren
ALTER TABLE peaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE summits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- Peaks und Safety: öffentlich lesbar
CREATE POLICY "Peaks sind öffentlich" ON peaks FOR SELECT USING (true);
CREATE POLICY "Safety ist öffentlich" ON safety_status FOR SELECT USING (true);

-- User Profiles: eigene lesen/schreiben, alle lesen
CREATE POLICY "Eigenes Profil schreiben" ON user_profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Alle Profile lesen" ON user_profiles
  FOR SELECT USING (true);

-- Summits: eigene schreiben, alle lesen
CREATE POLICY "Eigene Summits schreiben" ON summits
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Alle Summits lesen" ON summits
  FOR SELECT USING (true);

-- Ownership + Badges: nur lesen
CREATE POLICY "Ownership lesen" ON ownership FOR SELECT USING (true);
CREATE POLICY "Badges lesen" ON badges FOR SELECT USING (true);

-- Funktion: Saison aus Datum berechnen (z.B. "2026")
CREATE OR REPLACE FUNCTION get_season(ts TIMESTAMPTZ)
RETURNS TEXT AS $$
BEGIN
  RETURN EXTRACT(YEAR FROM ts)::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
