# Bergkönig — Projekt-Status (Stand: 2. April 2026)

## Was ist Bergkönig?
Gamifiziertes Gipfel-Sammel-Spiel für den Alpenraum. 53.000+ Gipfel.
Sammle Berge, werde König, verteidige deine Krone, erobere Gebiete.
Website: https://bergkoenig.app

## Tech Stack
- **Frontend:** Vanilla JS, Leaflet.js, kein Framework
- **Backend:** Supabase (PostgreSQL + Edge Functions + Auth + Storage)
- **Hosting:** GitHub Pages (docs/ Ordner) → bergkoenig.app
- **Repo:** github.com/Soellerhaus/gipfelkoenig (public)
- **DB Ref:** wbrvkweezbeakfphssxp.supabase.co

## Datei-Struktur
```
C:\gipfelkoenig\
├── frontend/          ← Quellcode (hier editieren!)
│   ├── index.html     ← Landing Page (DE)
│   ├── login.html     ← Login
│   ├── register.html  ← Registrierung
│   ├── app.html       ← Haupt-App (Karte, Feed, Gipfel, Rang, Profil)
│   ├── settings.html  ← Einstellungen (Strava/Suunto/GPX/Account)
│   ├── en/            ← Englische Versionen
│   ├── css/layout.css ← Alle Styles
│   ├── js/auth.js     ← Auth, Import, Profil-Logik
│   ├── js/map.js      ← Leaflet Karte, Marker, Hexagone
│   ├── js/game.js     ← Rangliste, Ränge, Sub-Regionen
│   ├── js/feed.js     ← Aktivitäten-Feed
│   ├── js/summits.js  ← Gipfel-Tab
│   └── img/           ← Logos (suunto-logo.png, strava-logo.png)
├── docs/              ← DEPLOY-Ordner (Kopie von frontend/ → GitHub Pages)
├── supabase/
│   ├── functions/
│   │   ├── import-activities/   ← Strava Import (seitenweise, Token-Refresh)
│   │   ├── strava-exchange-token/ ← Strava OAuth
│   │   ├── suunto-exchange-token/ ← Suunto OAuth
│   │   ├── suunto-webhook/      ← Suunto Auto-Import
│   │   ├── delete-account/      ← Account komplett löschen
│   │   └── process-activity/    ← Strava Webhook (einzelne Aktivität)
│   └── migrations/              ← DB Schema
└── scripts/
    ├── generate-descriptions.py ← KI-Beschreibungen für Gipfel
    └── create-test-data.py      ← 94 Test-User mit Fake-Daten
```

## WICHTIG: Deploy-Workflow
1. Dateien in `frontend/` editieren
2. `cp frontend/DATEI docs/DATEI` (oder ganzen Ordner kopieren)
3. `git add -A && git commit -m "..." && git push`
4. GitHub Pages deployed automatisch aus `docs/`
5. Edge Functions: `SUPABASE_ACCESS_TOKEN="sbp_64bb47cc198ca1dfc2226cbbf0740cd863b2eb68" npx supabase functions deploy FUNCTION_NAME --project-ref wbrvkweezbeakfphssxp`
6. Nach JEDEM Deploy: `curl -s -X PATCH "https://api.supabase.com/v1/projects/wbrvkweezbeakfphssxp/functions/FUNCTION_NAME" -H "Authorization: Bearer sbp_64bb47cc198ca1dfc2226cbbf0740cd863b2eb68" -H "Content-Type: application/json" -d '{"verify_jwt": false}'`

## WICHTIG: DE + EN
Jede Änderung an deutschen Seiten MUSS auch in der englischen Version gemacht werden (frontend/en/).

## Plattform-Verbindungen

### Strava ✅ GENEHMIGT + LIVE
- Client ID: 211591
- Client Secret: 7a7f59b117e1ec641cd49803eb2ea7ee40ff40f0
- Redirect URI: https://bergkoenig.app/settings.html
- Rate Limit: 600 Req/15min, 6000/Tag, 999 User
- Edge Functions: strava-exchange-token, import-activities, process-activity
- Import hat Auto-Token-Refresh via refresh_token

### Suunto ✅ GENEHMIGT + LIVE
- Client ID: 32db5831-859b-4ba5-888d-4b35d8dba7fe
- Client Secret: BK-suunto-2026-secret
- Subscription Key: b19a9773d9574f83a4e9d950c3ec9d5b
- Redirect URI: https://bergkoenig.app/settings.html
- Webhook URL: https://wbrvkweezbeakfphssxp.supabase.co/functions/v1/suunto-webhook
- Edge Functions: suunto-exchange-token, suunto-webhook, suunto-refresh-token
- Noch auf Development API — Production API beantragen für Go Live

### Garmin ⏳ IM GENEHMIGUNGSPROZESS
- Company: Bergkönig
- Email: claudio.scheiwiller@bergkoenig.app (IONOS Weiterleitung → claudio-sch@hotmail.com)
- 3. Bewerbung — "successfully verified, in approval process"

### GPX Upload ✅ FUNKTIONIERT
- In settings.html, 80m Gipfelerkennung

## Supabase Secrets (Edge Functions)
```
STRAVA_CLIENT_ID=211591
STRAVA_CLIENT_SECRET=7a7f59b117e1ec641cd49803eb2ea7ee40ff40f0
STRAVA_REDIRECT_URI=https://bergkoenig.app/settings.html
SUUNTO_CLIENT_ID=32db5831-859b-4ba5-888d-4b35d8dba7fe
SUUNTO_CLIENT_SECRET=BK-suunto-2026-secret
SUUNTO_REDIRECT_URI=https://bergkoenig.app/settings.html
SUUNTO_SUBSCRIPTION_KEY=b19a9773d9574f83a4e9d950c3ec9d5b
```

## Spielregeln (Das Ritterspiel)
1. SAMMLE GIPFEL — Jeder Berg = deine Sammlung
2. ERKÄMPFE KRONEN — Meiste Besteigungen = König
3. EROBERE GEBIETE — Meiste Kronen in Hex = Gebiet gehört dir
4. STEIG IM RANG AUF — Neuling → Wanderer → Bergsteiger → Ritter → Baron → Graf → Herzog → Bergkönig
5. VERTEIDIGE DEIN REICH — Andere können Kronen + Gebiete angreifen

### Punkte-Formel (EINHEITLICH überall!)
Basis = HM/100 + km + 10 (Gipfelbonus)
- Pionier (Erster der Saison): ×3
- Erstbesuch: ×2
- Wiederholung: ×0.5
- Frühaufsteher (<07:00): +15
- Combo (2+ Gipfel/Tag): +50%
- Kein AT-08 Heimat-Bonus

### Kronen-Regel
- König = meiste Besteigungen auf einem Gipfel in der Saison
- König vom Vorjahr BLEIBT König, bis jemand anderes den Berg in der neuen Saison besteigt
- Bei Gleichstand: beide sind König

### Lose (NUR aktuelle Saison — verfallen am Jahresende!)
- 1 Los pro Gipfel
- 2 Lose pro Krone (verlierbar!)
- 5 Lose pro Gebiet (verlierbar!)
- 5 Lose pro Gipfel des Tages
- 1 Los pro 1000 Punkte
- 1 Los pro 10.000 HM
- 1 Los pro 50 km

## Karten-Features
- Leaflet mit OpenTopoMap Tiles
- Hexagonales Territorien-Grid (18km Bienenwaben)
- Spieler-Farbe wählbar in Einstellungen
- Hex-Opacity Regler (vertikal)
- Gipfel des Tages (🃏 Hofnarr-Icon, 20km Radius, Schneegrenze)
- Hüpfende Kronen-Marker (CSS Animation)
- Konfetti bei Gipfelerkennung
- Gipfel-Beschreibungen (KI-generiert, ~2000 von 53.000 fertig)

## DB-Tabellen
- **peaks**: 53.479 Gipfel (id, name, lat, lng, elevation, osm_region, description)
- **summits**: Besteigungen (user_id, peak_id [nullable!], points, elevation_gain, distance, season, strava_activity_id)
- **user_profiles**: User (username, avatar_type, avatar_url, territory_color, strava_token, suunto_token, import_status, total_points, is_test_user)
- **ownership**: Gipfel-Besitz (wird kaum genutzt — König wird aus summits berechnet)
- **Storage Bucket**: AVATARS (Grossbuchstaben! Profilbilder)

## 94 Test-User
- Erstellt mit scripts/create-test-data.py
- Markiert mit is_test_user=true
- Löschbar mit: python scripts/create-test-data.py --delete
- Regionale Verteilung: Oberallgäu, Tirol, Bregenzerwald, Kleinwalsertal, Oberengadin, Salzburg, Berner Oberland

## Claudio's Accounts
- Gloitsch7 (aktuell aktiv) — claudio-sch@hotmail.com — Strava verbunden
- Ältere: Gloitsch, Gloitsch2-6 (verschiedene Tests, teils gelöscht)

## Bekannte Bugs / Offene Punkte
1. **Strava Import** — Token-Refresh ist eingebaut, aber Import braucht noch Feintuning (Aktivitäten ohne GPS werden übersprungen, peak_id=null Insert kann feilen bei NOT NULL Constraint)
2. **Schneelage-Layer** — Code existiert aber funktioniert nicht korrekt (Open-Meteo Grid-Darstellung), wurde zum Löschen markiert
3. **Account löschen** — Edge Function deployed, verify_jwt=false, funktioniert
4. **Profilbild Upload** — Storage Bucket "AVATARS" (Grossbuchstaben!), RLS Policies gesetzt
5. **HM/km Deduplizierung** — Wenn eine Aktivität mehrere Gipfel trifft, werden HM/km nur 1× gezählt (strava_activity_id)
6. **Strava Client Secret** steht noch in auth.js (Frontend!) → sollte in Edge Function verschoben werden
7. **Berg-Beschreibungen** — ~2000 von 53.000 generiert (Kleinwalsertal + Vorarlberg + Oberengadin komplett)

## Kontaktdaten
- Betreiber: Claudio Scheiwiller
- Adresse: Schöntalweg 10, 6992 Hirschegg, Österreich
- Email: claudio.scheiwiller@bergkoenig.app (Weiterleitung → claudio-sch@hotmail.com)
- Supabase Access Token: sbp_8661f991dc5e77813dad60705b92258e356979c6
- Supabase Service Role Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc
