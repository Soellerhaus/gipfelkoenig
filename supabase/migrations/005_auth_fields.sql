-- Auth-System Erweiterung: Consent-Felder, Avatar, Strava-Verbindungsdatum
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_version TEXT DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS avatar_type TEXT DEFAULT 'mountain',
  ADD COLUMN IF NOT EXISTS strava_connected_at TIMESTAMPTZ;
