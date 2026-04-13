#!/bin/bash
# Bergkönig — Deploy Script
# Deployed alle Edge Functions und setzt verify_jwt=false

PROJECT_REF="wbrvkweezbeakfphssxp"
TOKEN="${SUPABASE_ACCESS_TOKEN:-sbp_e63accd36b228666aa6a94c1f2ac8851061f7ee6}"

echo "=== Bergkönig Deploy ==="

# Alle Functions deployen
for fn in strava-webhook process-activity import-activities checkin delete-account suunto-exchange-token suunto-webhook suunto-refresh-token strava-exchange-token submit-sponsor; do
  if [ -d "supabase/functions/$fn" ]; then
    echo "Deploying $fn..."
    SUPABASE_ACCESS_TOKEN=$TOKEN npx supabase functions deploy $fn --project-ref $PROJECT_REF 2>&1 | tail -1
  fi
done

echo ""
echo "=== verify_jwt=false setzen ==="

# Alle Functions auf verify_jwt=false setzen
for fn in strava-webhook process-activity import-activities checkin delete-account suunto-exchange-token suunto-webhook suunto-refresh-token strava-exchange-token submit-sponsor; do
  result=$(curl -s -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/functions/$fn" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"verify_jwt": false}')
  jwt=$(echo $result | python -c "import json,sys; print(json.loads(sys.stdin.read()).get('verify_jwt','?'))" 2>/dev/null)
  echo "  $fn → jwt: $jwt"
done

echo ""
echo "=== Fertig! ==="
