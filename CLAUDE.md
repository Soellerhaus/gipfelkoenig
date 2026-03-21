# Gipfelkönig — Projektkontext für Claude Code

## Was ist dieses Projekt?
Gipfelkönig ist eine gamifizierte Gipfel-Tracking-App für den Alpenraum.
Sammle Gipfel, sammle Höhenmeter — für Wanderer, Trailrunner und Kletterer.
Nicht die Geschwindigkeit zählt, sondern die Gipfel und die Höhenmeter.
Keine Vergleichs-App, sondern Motivation sich zu bewegen.
Vollautomatisch via Strava Webhook oder manuellen GPS Check-in.
Mit eingebautem Sicherheitssystem via ALBINA Lawinenlagebericht API.

## Philosophie
- Alle sind willkommen: Wanderer, Trailrunner, Kletterer
- Nicht die Geschwindigkeit zählt, sondern Gipfel + Höhenmeter
- Motivation statt Wettbewerb — "Du hast 12 Gipfel gesammelt!" statt "Du bist Platz 3"
- Geschlechtsneutrale Sprache wo möglich (König/Königin)
- Keine Zeiten, keine "schnellster Aufstieg" Features

## Tech Stack
- Frontend: Vanilla JS, kein Framework, kein Build-Tool
- Backend: Supabase (PostgreSQL + PostGIS + Edge Functions + Auth)
- GPS: Strava Webhook API → process-activity Edge Function
- Gipfel: OpenStreetMap Overpass API (54 Kleinwalsertal-Gipfel, erweiterbar)
- Sicherheit: ALBINA EAWS Ratings API (täglich Cron)
- Hosting: Statische Files auf Contabo VPS

## Wichtige Befehle
- Supabase lokal: supabase start
- Functions deployen: supabase functions deploy
- DB Migration: supabase db push
- Gipfel importieren: node supabase/seed/import-peaks.js
- Tests: node api-tests/test-osm-peaks.js

## Kern-Dateien
- supabase/migrations/001_initial.sql → Datenbankschema (PostGIS!)
- supabase/functions/process-activity/index.ts → KERNLOGIK GPS+Gipfel
- supabase/functions/update-safety/index.ts → ALBINA Cron
- frontend/js/map.js → Leaflet Karte
- frontend/js/game.js → Punkte + Ownership Logik

## API-Endpunkte (verifiziert in Phase 1)
- OSM Peaks: POST https://overpass-api.de/api/interpreter
- ALBINA Ratings: https://static.avalanche.report/eaws_bulletins/{date}/{date}-AT-08.ratings.json
- ALBINA Latest: https://api.avalanche.report/albina/api/bulletins/latest
- Strava Streams: GET /api/v3/activities/{id}/streams?keys=latlng,altitude,time

## Coding Standards
- Kein TypeScript im Frontend, nur Vanilla JS
- Edge Functions in TypeScript (Deno)
- CSS: Immer CSS Variables verwenden, keine hardcodierten Werte
- Keine externen Libraries außer: Leaflet.js, Supabase JS Client
- Immer error handling, nie stumme Fehler
- Kommentare auf Deutsch

## Sicherheits-Regel (KRITISCH)
Gefahrenstufe >= 3 → KEINE Punkte für diesen Gipfel
Diese Regel ist NICHT verhandelbar und muss in process-activity UND in der
checkin Function doppelt geprüft werden.

## Punkte-Formel
points = elevation
if (seasonFirst) points *= 3
else if (personalFirst) points *= 1.5
else points *= 0.2  // Wiederholung
if (multiPeak) points += 500  // Combo
if (homeRegion) points += 100  // AT-08 Heimat-Bonus

## Strava-Datenschutz
- GPS-Tracks nur verarbeiten, NICHT speichern
- Nur abgeleitete Daten anzeigen (Gipfel-Uhrzeit, Aufstiegszeit)
- Niemals den Track anderen Usern zeigen
- "Powered by Strava" Logo muss sichtbar sein
