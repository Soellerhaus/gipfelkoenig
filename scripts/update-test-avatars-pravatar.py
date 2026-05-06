#!/usr/bin/env python3
"""
Update Test-User auf Pravatar-Portraits (echte Gesichter, ~70 unique).
Schnell und zuverlaessig, alle URLs garantiert erreichbar.

Usage:
  export SUPABASE_SERVICE_KEY="eyJ..."
  python scripts/update-test-avatars-pravatar.py
"""
import os
import sys
import requests

SUPABASE_URL = "https://wbrvkweezbeakfphssxp.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
REST_BASE = f"{SUPABASE_URL}/rest/v1"

if not SUPABASE_KEY:
    print("FEHLER: SUPABASE_SERVICE_KEY nicht gesetzt"); sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

print("Lade Test-User...", flush=True)
resp = requests.get(
    f"{REST_BASE}/user_profiles",
    headers={**HEADERS, "Prefer": "return=representation"},
    params={"is_test_user": "eq.true", "select": "id,username"},
    timeout=30,
)
resp.raise_for_status()
users = resp.json()
print(f"  {len(users)} Test-User\n", flush=True)

print("Update Avatare auf Pravatar (echte Foto-Portraits)...", flush=True)
ok = 0
fail = 0
for i, u in enumerate(users):
    seed = u["username"] or u["id"]
    safe = requests.utils.quote(seed)
    # Pravatar gibt 70 unique Fotos zurueck. Mit Seed deterministisch.
    new_url = f"https://i.pravatar.cc/300?u={safe}"
    r = requests.patch(
        f"{REST_BASE}/user_profiles",
        headers=HEADERS,
        params={"id": f"eq.{u['id']}"},
        json={"avatar_url": new_url},
        timeout=30,
    )
    if r.status_code in (200, 204): ok += 1
    else:
        fail += 1
        print(f"  ! {u['username']}: {r.status_code}", flush=True)
    if (i + 1) % 100 == 0:
        print(f"  [{i+1}/{len(users)}] updated", flush=True)

print(f"\nFERTIG  ok={ok}  fail={fail}", flush=True)
