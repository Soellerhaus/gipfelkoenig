#!/usr/bin/env python3
"""
Bergkoenig — Update Test-User Avatare
======================================

Ersetzt DiceBear-Cartoon-Avatare durch echte Foto-Portraits von
randomuser.me. Ca. 200 unique echte Fotos (Mann/Frau, verschiedene Alter).

Usage:
  export SUPABASE_SERVICE_KEY="eyJ..."
  python scripts/update-test-avatars.py
"""
import os
import random
import sys
import requests

SUPABASE_URL = "https://wbrvkweezbeakfphssxp.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
REST_BASE = f"{SUPABASE_URL}/rest/v1"

if not SUPABASE_KEY:
    print("FEHLER: export SUPABASE_SERVICE_KEY=eyJ... setzen!")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

# randomuser.me bietet 100 Mann + 100 Frau Portraits frei verlinkbar.
# URL-Pattern: https://randomuser.me/api/portraits/{men|women}/{0-99}.jpg
# Hochaufloesend: ../portraits/   (verschiedene Groessen via folder)
NUM_MEN = 100
NUM_WOMEN = 100


def detect_gender(display_name):
    """Heuristik aus dem display_name: weibliche Endungen -> female."""
    if not display_name:
        return random.choice(["m", "f"])
    first = display_name.split(" ")[0].lower()
    # Typische weibliche Endungen
    female_endings = ("a", "e", "ie", "in", "ina")
    female_names = {
        "anna","lisa","sandra","julia","kathrin","maria","simone","elena","claudia",
        "martina","laura","stefanie","nina","sonja","petra","monika","christine","susanne",
        "daniela","verena","heidi","birgit","andrea","karin","manuela","bettina","doris",
        "renate","cornelia","elisabeth","sabine","roswitha","brigitte","eveline","ingrid",
        "katharina","veronika","magdalena","theresa","barbara","christina","annemarie",
        "gertrude","helga","hannelore","tanja","carmen","iris","yvonne","romana","resi",
        "burgi","therese","adelheid","hildegard","ilse","erna","gerlinde","berta","kunigunde",
        "aloisia","notburga","crescentia","kreszenz","walpurga","theresia","annerose","trudi",
        "margrit","beatrix","ursula","gertrud","hedwig","rosmarie","gianna","stefania",
        "verena","erika","madeleine","susi","brigitt","margrith","sofia","giulia","francesca",
        "marta","chiara","sara","filomena","sophie","claire","marion","camille","élise",
        "hélène","anne","isabelle","catherine","nathalie","trailqueen","bergfee","alpenrose",
        "gipfelhexe","edelweiss","bergkönigin","schneerose","alpenkristall","klettermaus",
    }
    if first in female_names:
        return "f"
    if first.endswith(female_endings):
        return "f"
    return "m"


def make_real_avatar_url(seed_str, gender):
    """Echtes Portrait-Foto von randomuser.me. Seed-stabil pro User."""
    pool = NUM_WOMEN if gender == "f" else NUM_MEN
    folder = "women" if gender == "f" else "men"
    # Hash vom seed in 0..pool-1
    idx = sum(ord(c) for c in seed_str) % pool
    return f"https://randomuser.me/api/portraits/{folder}/{idx}.jpg"


def main():
    # Alle Test-User holen
    print("Lade alle Test-User...")
    resp = requests.get(
        f"{REST_BASE}/user_profiles",
        headers={**HEADERS, "Prefer": "return=representation"},
        params={
            "is_test_user": "eq.true",
            "select": "id,username,display_name,avatar_url",
        },
        timeout=30,
    )
    resp.raise_for_status()
    users = resp.json()
    print(f"  {len(users)} Test-User gefunden")

    if not users:
        print("Keine Test-User da. Erst create-fake-users-500.py --create laufen lassen.")
        return

    print("\nUpdate Avatare auf echte Portraits (randomuser.me)...")
    success = 0
    fail = 0
    for i, u in enumerate(users):
        gender = detect_gender(u.get("display_name") or u.get("username") or "")
        new_url = make_real_avatar_url(u["username"] or u["id"], gender)
        r = requests.patch(
            f"{REST_BASE}/user_profiles",
            headers=HEADERS,
            params={"id": f"eq.{u['id']}"},
            json={"avatar_url": new_url},
            timeout=30,
        )
        if r.status_code in (200, 204):
            success += 1
        else:
            fail += 1
            print(f"  ! {u['username']}: {r.status_code} {r.text[:100]}")

        if (i + 1) % 50 == 0 or i + 1 == len(users):
            print(f"  [{i+1:3d}/{len(users)}] {u['username']:30s} ({gender}) -> {new_url}")

    print(f"\n{'='*60}")
    print(f"FERTIG")
    print(f"  Updated: {success}")
    print(f"  Failed:  {fail}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
