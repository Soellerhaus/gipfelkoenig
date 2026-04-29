-- Bergkoenig — neue Spalte fuer Titel-Posting Opt-out
-- Default true: Titel wird automatisch generiert. User kann in Settings deaktivieren.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS strava_post_title BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN user_profiles.strava_post_title IS
  'Wenn true: Bergkönig generiert wechselnde Wetter+Leistungs-Titel auf Strava';
COMMENT ON COLUMN user_profiles.strava_post_summits IS
  'Wenn true: Bergkönig schreibt Gipfel/Punkte in die Strava-Beschreibung';
