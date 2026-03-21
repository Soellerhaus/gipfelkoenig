# Gipfelkönig

Das Besitz-Spiel für echte Alpengipfel. Wer den Gipfel am häufigsten erklimmt, dem gehört er.

## Setup in 5 Minuten

### 1. Supabase Projekt anlegen
- Gehe zu [supabase.com](https://supabase.com) → neues Projekt
- SQL Editor → `supabase/migrations/001_initial.sql` einfügen und ausführen
- Project Settings → API → URL und Keys kopieren

### 2. Environment konfigurieren
```bash
cp .env.example .env
# Supabase URL + Keys eintragen
```

### 3. Strava App anlegen
- [strava.com/settings/api](https://www.strava.com/settings/api) → neue App
- Client ID + Secret in `.env` eintragen
- Authorization Callback Domain: `gipfelkoenig.at`

### 4. Gipfel importieren
```bash
node supabase/seed/import-peaks.js
```

### 5. Frontend starten
Statische Dateien aus `frontend/` auf einem Webserver bereitstellen:
```bash
cd frontend && python3 -m http.server 8080
```

## Technologie
- **Frontend**: Vanilla JS, Leaflet.js, Supabase JS Client
- **Backend**: Supabase (PostgreSQL + PostGIS + Edge Functions)
- **APIs**: OpenStreetMap, ALBINA Avalanche, Strava
