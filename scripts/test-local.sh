#!/bin/bash
# Gipfelkönig — Lokaler Test
# Startet einen einfachen HTTP-Server für das Frontend

echo "═══════════════════════════════════════"
echo "  Gipfelkönig — Lokaler Test"
echo "═══════════════════════════════════════"
echo ""
echo "→ Starte Server auf http://localhost:8080"
echo "  Öffne http://localhost:8080 im Browser"
echo "  Strg+C zum Beenden"
echo ""

cd "$(dirname "$0")/../frontend"

# Python 3 als einfacher HTTP-Server
if command -v python3 &> /dev/null; then
  python3 -m http.server 8080
elif command -v python &> /dev/null; then
  python -m http.server 8080
elif command -v npx &> /dev/null; then
  npx serve -l 8080
else
  echo "❌ Kein HTTP-Server gefunden. Installiere Python 3 oder Node.js."
  exit 1
fi
