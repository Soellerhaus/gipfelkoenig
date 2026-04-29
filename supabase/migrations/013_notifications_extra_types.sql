-- Bergkoenig — Notifications-Tabelle erstellen falls fehlt + neue Typen erlauben
-- Falls 011_notifications.sql nie remote ausgefuehrt wurde, holt diese Migration es nach.

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  icon       TEXT DEFAULT '🔔',
  data       JSONB,
  read       BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notif_user_idx ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notif_unread_idx ON notifications(user_id) WHERE read = false;

-- Alten CHECK-Constraint entfernen (falls vorhanden) und neuen mit zusaetzlichen Typen anlegen
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'crown_attack', 'crown_lost', 'crown_won',
    'pioneer', 'territory_won',
    'lose_earned',
    'new_prize', 'rank_change', 'weekly_recap'
  ));

-- RLS sicherstellen
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Eigene Notifications lesen" ON notifications;
CREATE POLICY "Eigene Notifications lesen" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Eigene Notifications updaten" ON notifications;
CREATE POLICY "Eigene Notifications updaten" ON notifications
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service inserts" ON notifications;
CREATE POLICY "Service inserts" ON notifications
  FOR INSERT WITH CHECK (true);
