-- Bergkoenig — Benachrichtigungen
-- Persistierte In-App-Notifications fuer Krone, Pionier, Preise, Rang, Wochenrueckblick

CREATE TABLE notifications (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK(type IN ('crown_attack', 'crown_lost', 'pioneer', 'new_prize', 'rank_change', 'weekly_recap')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  icon       TEXT DEFAULT '🔔',
  data       JSONB,
  read       BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX notif_user_idx ON notifications(user_id, created_at DESC);
CREATE INDEX notif_unread_idx ON notifications(user_id) WHERE read = false;

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- User liest eigene Notifications
CREATE POLICY "Eigene Notifications lesen" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

-- User markiert eigene als gelesen
CREATE POLICY "Eigene Notifications updaten" ON notifications
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Edge Functions (service_role) koennen inserten
CREATE POLICY "Service inserts" ON notifications
  FOR INSERT WITH CHECK (true);

-- Alte Notifications nach 90 Tagen automatisch loeschen (optional per Cron)
-- DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '90 days';
