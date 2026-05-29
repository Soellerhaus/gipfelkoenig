-- Bergkoenig — Web-Push-Abos
-- Speichert die Push-Subscriptions der Browser/Geraete pro User, damit die
-- send-push Edge Function gezielt Benachrichtigungen zustellen kann.

CREATE TABLE push_subscriptions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ein Endpoint ist global eindeutig (ein Geraet/Browser)
  UNIQUE (endpoint)
);

CREATE INDEX push_sub_user_idx ON push_subscriptions(user_id);

-- RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- User darf eigene Abos anlegen
CREATE POLICY "Eigenes Push-Abo anlegen" ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- User darf eigene Abos lesen
CREATE POLICY "Eigene Push-Abos lesen" ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- User darf eigene Abos loeschen (Abmeldung)
CREATE POLICY "Eigenes Push-Abo loeschen" ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

-- Edge Functions (service_role) duerfen alles (z.B. tote Abos aufraeumen)
CREATE POLICY "Service verwaltet Push-Abos" ON push_subscriptions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
