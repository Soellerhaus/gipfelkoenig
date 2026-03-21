#!/bin/bash
# Gipfelkönig — Deployment auf VPS
# Voraussetzung: SSH-Zugang zum Server, rsync installiert

SERVER="root@gipfelkoenig.at"
REMOTE_PATH="/var/www/gipfelkoenig"

echo "═══════════════════════════════════════"
echo "  Gipfelkönig — Deployment"
echo "═══════════════════════════════════════"

# Frontend deployen
echo "→ Deploye Frontend..."
rsync -avz --delete \
  frontend/ \
  "$SERVER:$REMOTE_PATH/" \
  --exclude='.DS_Store'

echo "✓ Frontend deployed"

# Supabase Functions deployen (falls supabase CLI installiert)
if command -v supabase &> /dev/null; then
  echo "→ Deploye Supabase Edge Functions..."
  supabase functions deploy strava-webhook
  supabase functions deploy process-activity
  supabase functions deploy update-safety
  supabase functions deploy checkin
  echo "✓ Edge Functions deployed"
else
  echo "⚠ Supabase CLI nicht installiert — Functions manuell deployen"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  Deployment abgeschlossen"
echo "═══════════════════════════════════════"
