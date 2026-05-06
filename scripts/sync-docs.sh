#!/bin/bash
# Bergkönig — Sync frontend/ → docs/ für GitHub Pages
#
# Hintergrund: bergkoenig.app laeuft auf GitHub Pages, serviert aus /docs.
# Wir editieren aber in /frontend (sauberere Struktur). Vor jedem Push:
#   bash scripts/sync-docs.sh
#
# Kopiert nur Files die sich geaendert haben (rsync-style via cp -u).

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/frontend"
DST="$ROOT/docs"

if [ ! -d "$SRC" ] || [ ! -d "$DST" ]; then
  echo "Fehler: $SRC oder $DST nicht gefunden"
  exit 1
fi

echo "═══════════════════════════════════════"
echo "  Sync frontend/ → docs/"
echo "═══════════════════════════════════════"

# WICHTIG: docs/CNAME nicht ueberschreiben (zeigt auf bergkoenig.app)
# WICHTIG: docs/.nojekyll behalten (verhindert Jekyll-Processing)
# Ansonsten: alle Files kopieren mit Update-Mode (-u)
cp -ru "$SRC"/* "$DST"/ 2>&1 | tail -5

# CNAME wiederherstellen falls aus frontend ueberschrieben
if [ -f "$DST/CNAME" ]; then
  echo "✓ docs/CNAME erhalten"
else
  echo "bergkoenig.app" > "$DST/CNAME"
  echo "⚠ docs/CNAME war weg — wiederhergestellt"
fi

# .nojekyll erhalten/erstellen
touch "$DST/.nojekyll"

# Diff anzeigen
echo ""
echo "Geaenderte Dateien (nach Sync):"
cd "$ROOT" && git status -s docs/ | head -20

echo ""
echo "✓ Sync fertig. Jetzt: git add docs/ && git commit && git push"
