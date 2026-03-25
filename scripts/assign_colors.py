"""
Assign random territory colors to all 94 test users via Supabase REST API.
"""
import requests
import random

SUPABASE_URL = "https://wbrvkweezbeakfphssxp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

PALETTE = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
    "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
    "#F0B27A", "#82E0AA", "#F1948A", "#AED6F1", "#D7BDE2",
    "#A3E4D7", "#FAD7A0", "#A9CCE3", "#D5F5E3", "#FADBD8",
]

# 1. Fetch all test users
resp = requests.get(
    f"{SUPABASE_URL}/rest/v1/user_profiles?is_test_user=eq.true&select=id,username",
    headers=HEADERS,
)
resp.raise_for_status()
users = resp.json()
print(f"Found {len(users)} test users")

# 2. Assign random color to each
updated = 0
for user in users:
    color = random.choice(PALETTE)
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/user_profiles?id=eq.{user['id']}",
        headers=HEADERS,
        json={"territory_color": color},
    )
    r.raise_for_status()
    updated += 1

print(f"Updated {updated} users with random territory colors")
