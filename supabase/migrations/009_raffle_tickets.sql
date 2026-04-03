-- Losnummern-System: Jedes Los bekommt eine zufällige Nummer 1-10000
-- Nummern sind pro Saison einzigartig und werden bei Verlust (Krone/Gebiet) gelöscht

CREATE TABLE IF NOT EXISTS raffle_tickets (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  ticket_number INT NOT NULL CHECK (ticket_number BETWEEN 1 AND 10000),
  source TEXT NOT NULL,   -- 'gipfel', 'krone', 'punkte', 'hm', 'km'
  source_ref TEXT,        -- z.B. peak_id, 'punkte-3000', 'hm-20000', 'km-150'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_raffle_user_season ON raffle_tickets(user_id, season);

-- RLS: User sieht nur eigene Tickets, kann aber alle Nummern prüfen (für Duplikat-Check)
ALTER TABLE raffle_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tickets" ON raffle_tickets
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own tickets" ON raffle_tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tickets" ON raffle_tickets
  FOR DELETE USING (auth.uid() = user_id);

-- Service Role kann alles (für Edge Functions)
CREATE POLICY "Service role full access" ON raffle_tickets
  FOR ALL USING (auth.role() = 'service_role');
