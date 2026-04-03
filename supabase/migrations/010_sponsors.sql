-- Bergkönig — Sponsor/Partner System
-- Sponsoren stellen Preise bereit und wählen Hex-Regionen auf der Karte

CREATE TABLE IF NOT EXISTS sponsors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  logo_url TEXT,
  website_url TEXT,
  product_url TEXT,
  prize_name TEXT NOT NULL,
  prize_description TEXT,
  prize_image_url TEXT,
  prize_value TEXT,
  -- Hex-Regionen als Array von "col,row" Keys (matching getHexKey() in map.js)
  -- WICHTIG: HEX_SIZE_KM=5 ist eingefroren — darf sich nicht mehr ändern!
  hex_regions TEXT[] DEFAULT '{}',
  all_regions BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired')),
  contract_accepted BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  valid_until DATE
);

-- Indizes
CREATE INDEX IF NOT EXISTS idx_sponsors_status ON sponsors (status);
CREATE INDEX IF NOT EXISTS idx_sponsors_hex_regions ON sponsors USING GIN (hex_regions);

-- RLS: Nur aktive Sponsoren öffentlich lesbar
ALTER TABLE sponsors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Aktive Sponsoren öffentlich lesbar"
  ON sponsors FOR SELECT
  USING (status = 'active');

-- Service Role kann alles (Edge Functions)
CREATE POLICY "Service Role vollzugriff"
  ON sponsors FOR ALL
  USING (true)
  WITH CHECK (true);
