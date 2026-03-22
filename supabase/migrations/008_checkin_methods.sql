-- Erweitere checkin_method um gpx_upload, garmin, suunto
ALTER TABLE summits DROP CONSTRAINT IF EXISTS summits_checkin_method_check;
ALTER TABLE summits ADD CONSTRAINT summits_checkin_method_check
  CHECK(checkin_method IN ('strava', 'manual', 'gpx_upload', 'garmin', 'suunto'));
