#!/usr/bin/env python3
"""
Gipfelkoenig Test Data Generator
=================================
Erstellt 100 Test-User mit realistischen Gipfeldaten.

Usage:
  python create-test-data.py --create   # Erstelle alle Testdaten
  python create-test-data.py --delete   # Loesche alle Testdaten (is_test_user = true)
  python create-test-data.py --count    # Zeige Anzahl Test-User/Summits
"""

import argparse
import json
import os
import random
import sys
from datetime import datetime, timedelta
from uuid import uuid4

try:
    import requests
except ImportError:
    print("FEHLER: 'requests' Bibliothek nicht installiert.")
    print("  pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Supabase Config
# ---------------------------------------------------------------------------
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wbrvkweezbeakfphssxp.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
REST_BASE = f"{SUPABASE_URL}/rest/v1"

MIGRATION_SQL = """
-- Fuehre dieses SQL in der Supabase SQL-Konsole aus, falls noch nicht vorhanden:
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_test_user BOOLEAN DEFAULT false;
"""

# ---------------------------------------------------------------------------
# Avatar types
# ---------------------------------------------------------------------------
AVATAR_TYPES = ["mountain", "eagle", "ski", "climber", "tree", "snow", "deer", "rock"]

# ---------------------------------------------------------------------------
# Regional user definitions
# ---------------------------------------------------------------------------
REGIONS = {
    "kleinwalsertal": {
        "lat_min": 47.30, "lat_max": 47.38, "lng_min": 10.05, "lng_max": 10.22,
        "home_region": "AT-08",
        "users": [
            "WalserBerg", "AlpinMax", "KanzelKoenig", "BregenzerAdler",
            "MontafonRider", "IfenHiker", "WiddersteinWolf", "GottesackerGeist",
            "HoherIfenMax", "BaadWanderer", "RiezlernRunner", "MittelbergMichi",
            "TurasKletterer", "WalserTanne", "KleinwalserKing", "Heuberg_Heidi",
            "KantAlpinist",
        ],
    },
    "oberallgaeu": {
        "lat_min": 47.30, "lat_max": 47.50, "lng_min": 10.15, "lng_max": 10.50,
        "home_region": "DE-BY",
        "users": [
            "AllgaeuPower", "NebelStuermer", "FellhornFox", "OberstdorfKing",
            "SoellereckStar", "NebelhornNinja", "RubiAlpinist", "AllgaeuAdler",
            "BreitachKing", "IllertalIgel", "OyMittelbergOx", "BolsterlangBaer",
            "FischenFalke", "BalderschwangBock", "GrasgehrenGeist", "HoechstenHero",
            "AllgaeuGams",
        ],
    },
    "tirol": {
        "lat_min": 47.15, "lat_max": 47.35, "lng_min": 10.80, "lng_max": 11.60,
        "home_region": "AT-07",
        "users": [
            "InnsbruckEagle", "StubaiFalke", "ZillertalZeus", "BrennerBaer",
            "PatscherkofelPuma", "NordketteNomad", "AxamerAxel", "SellrainSturm",
            "WipptalWolf", "KuhtaiKoenig", "OetztalOtter", "PitztalPanther",
            "MiemingMaus", "SerlesSturm", "HafelekaarHeld", "TirolerTrail",
            "StamsSteinbock",
        ],
    },
    "salzburg": {
        "lat_min": 47.10, "lat_max": 47.40, "lng_min": 12.80, "lng_max": 13.20,
        "home_region": "AT-05",
        "users": [
            "MozartPeak", "PinzgauPuma", "SalzburgSteinbock", "KaprunKoenig",
            "ZellAmSeeZander", "GlocknergratGuru", "GasteinGeier", "TennengauTiger",
            "PongauPanther", "LungauLuchs", "HochkoenigHeld", "UntersbergUhu",
            "DachsteinDrache", "FlachauFalke", "SaalfeldenStar",
        ],
    },
    "oberengadin": {
        "lat_min": 46.40, "lat_max": 46.60, "lng_min": 9.70, "lng_max": 10.10,
        "home_region": "CH-GR",
        "users": [
            "EngadinExplorer", "BerninaBlitz", "PizPaluKing", "DavosDragon",
            "StMoritzStar", "SilvaplanaSturm", "CorvatschCracker", "MuottasMuragl",
            "PontresinaPuma", "DiavolezzaDemon", "LagazAlpinist", "JulierJaeger",
            "AlbulaAdler", "BeverBock", "ZuozZorro",
        ],
    },
    "berner_oberland": {
        "lat_min": 46.50, "lat_max": 46.70, "lng_min": 7.80, "lng_max": 8.20,
        "home_region": "CH-BE",
        "users": [
            "EigerNordwand", "JungfrauJoker", "MoenchMaster", "GrindelwaldGeist",
            "InterlaknerAdler", "BrienzBaer", "ThunTiger", "LauterbrunnenLoewe",
            "WengenWolf",
        ],
    },
    "general_alpine": {
        # General users get assigned to a random region's bounds at summit time
        "lat_min": 47.15, "lat_max": 47.50, "lng_min": 9.70, "lng_max": 11.60,
        "home_region": "AT-08",
        "users": [
            "AlpenRitter", "GipfelJaeger", "BergNomad", "TrailWolf",
            "HoehenAdler", "GratGeher", "SteigEisen", "FelsKoenig",
            "WandererMax", "BergFex",
        ],
    },
}

# Neighboring region mapping for cross-region summits
NEIGHBOR_REGIONS = {
    "kleinwalsertal": ["oberallgaeu", "tirol"],
    "oberallgaeu": ["kleinwalsertal", "tirol"],
    "tirol": ["oberallgaeu", "salzburg", "oberengadin"],
    "salzburg": ["tirol"],
    "oberengadin": ["berner_oberland", "tirol"],
    "berner_oberland": ["oberengadin"],
    "general_alpine": ["kleinwalsertal", "oberallgaeu", "tirol"],
}


def get_headers():
    """Return Supabase REST API headers."""
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def supabase_get(table, params=None):
    """GET request to Supabase REST API."""
    url = f"{REST_BASE}/{table}"
    resp = requests.get(url, headers=get_headers(), params=params or {})
    resp.raise_for_status()
    return resp.json()


def supabase_post(table, data):
    """POST (insert) to Supabase REST API."""
    url = f"{REST_BASE}/{table}"
    headers = get_headers()
    headers["Prefer"] = "return=representation,resolution=ignore-duplicates"
    resp = requests.post(url, headers=headers, json=data)
    if resp.status_code not in (200, 201):
        print(f"  FEHLER POST {table}: {resp.status_code} {resp.text[:300]}")
    return resp


def supabase_patch(table, match_params, data):
    """PATCH (update) rows matching params."""
    url = f"{REST_BASE}/{table}"
    headers = get_headers()
    resp = requests.patch(url, headers=headers, params=match_params, json=data)
    if resp.status_code not in (200, 204):
        print(f"  FEHLER PATCH {table}: {resp.status_code} {resp.text[:300]}")
    return resp


def supabase_delete(table, params):
    """DELETE rows matching params."""
    url = f"{REST_BASE}/{table}"
    resp = requests.delete(url, headers=get_headers(), params=params)
    if resp.status_code not in (200, 204):
        print(f"  FEHLER DELETE {table}: {resp.status_code} {resp.text[:300]}")
    return resp


# ---------------------------------------------------------------------------
# Check prerequisite: is_test_user column
# ---------------------------------------------------------------------------
def check_test_user_column():
    """Check if is_test_user column exists by attempting a filtered query."""
    url = f"{REST_BASE}/user_profiles"
    params = {"is_test_user": "eq.true", "select": "id", "limit": "1"}
    resp = requests.get(url, headers=get_headers(), params=params)
    if resp.status_code != 200 and "is_test_user" in resp.text:
        print("=" * 60)
        print("ACHTUNG: Die Spalte 'is_test_user' fehlt in user_profiles!")
        print("Fuehre folgendes SQL in der Supabase SQL-Konsole aus:")
        print(MIGRATION_SQL)
        print("=" * 60)
        return False
    return True


# ---------------------------------------------------------------------------
# Fetch peaks for a region (by lat/lng bounds)
# ---------------------------------------------------------------------------
def fetch_peaks_for_region(region_key):
    """Load peaks within the lat/lng bounds of a region."""
    r = REGIONS[region_key]
    params = {
        "select": "id,name,elevation,lat,lng",
        "lat": f"gte.{r['lat_min']}",
        "lng": f"gte.{r['lng_min']}",
        "is_active": "eq.true",
        "limit": "500",
    }
    # Supabase REST needs separate range params; use and conditions
    url = f"{REST_BASE}/peaks"
    headers = get_headers()
    # Build query string manually for multiple conditions on same column
    qs = (
        f"select=id,name,elevation,lat,lng"
        f"&lat=gte.{r['lat_min']}&lat=lte.{r['lat_max']}"
        f"&lng=gte.{r['lng_min']}&lng=lte.{r['lng_max']}"
        f"&is_active=eq.true&limit=500"
    )
    resp = requests.get(f"{url}?{qs}", headers=headers)
    if resp.status_code != 200:
        print(f"  Warnung: Peaks laden fuer {region_key} fehlgeschlagen: {resp.status_code}")
        return []
    peaks = resp.json()
    return peaks


# ---------------------------------------------------------------------------
# Generate random summit data
# ---------------------------------------------------------------------------
def random_date_in_season(season):
    """Return a random datetime within the given season year."""
    year = int(season)
    start = datetime(year, 1, 1)
    if year == 2026:
        end = datetime(2026, 3, 25)
    else:
        end = datetime(year, 12, 31)
    delta = (end - start).days
    if delta <= 0:
        delta = 1
    rand_days = random.randint(0, delta)
    rand_hours = random.randint(6, 17)  # realistic hiking hours
    rand_mins = random.randint(0, 59)
    return start + timedelta(days=rand_days, hours=rand_hours, minutes=rand_mins)


def generate_summit_record(user_id, peak, season, is_season_first, is_personal_first):
    """Create a single summit record dict."""
    elevation = peak.get("elevation") or random.randint(1200, 2800)
    elevation_gain = int(elevation * random.uniform(0.4, 0.9))
    distance = round(elevation_gain / 100 * random.uniform(1.5, 3.0), 1)
    points = int(elevation_gain / 100 + distance + 10)

    # Checkin method weighted
    r = random.random()
    if r < 0.70:
        method = "strava"
    elif r < 0.90:
        method = "manual"
    else:
        method = "gpx_upload"

    summited_at = random_date_in_season(season)

    return {
        "id": str(uuid4()),
        "user_id": user_id,
        "peak_id": peak["id"],
        "summited_at": summited_at.isoformat(),
        "season": season,
        "elevation_gain": elevation_gain,
        "points": points,
        "checkin_method": method,
        "is_season_first": is_season_first,
        "is_personal_first": is_personal_first,
        "safety_ok": True,
    }


# ---------------------------------------------------------------------------
# CREATE
# ---------------------------------------------------------------------------
def create_test_data():
    """Create 100 test users with summit data."""
    print(MIGRATION_SQL)

    if not check_test_user_column():
        sys.exit(1)

    # Check for existing test users
    existing = supabase_get("user_profiles", {
        "is_test_user": "eq.true",
        "select": "id,username",
    })
    existing_usernames = {u["username"] for u in existing}
    if existing_usernames:
        print(f"Bereits {len(existing_usernames)} Test-User vorhanden.")

    # Load peaks per region (cache)
    print("\nLade Gipfel pro Region...")
    peaks_cache = {}
    for region_key in REGIONS:
        peaks = fetch_peaks_for_region(region_key)
        peaks_cache[region_key] = peaks
        print(f"  {region_key}: {len(peaks)} Gipfel")

    # Warn if any region has no peaks
    empty_regions = [k for k, v in peaks_cache.items() if not v]
    if empty_regions:
        print(f"\nWarnung: Keine Gipfel in: {', '.join(empty_regions)}")
        print("Diese Regionen werden uebersprungen.\n")

    # Build user list
    all_users = []
    for region_key, region_data in REGIONS.items():
        for username in region_data["users"]:
            all_users.append({
                "region": region_key,
                "username": username,
                "home_region": region_data["home_region"],
            })

    print(f"\nTotal geplante Test-User: {len(all_users)}")

    created_users = 0
    total_summits = 0

    for i, user_info in enumerate(all_users):
        username = user_info["username"]
        region_key = user_info["region"]

        if username in existing_usernames:
            print(f"  [{i+1}/{len(all_users)}] {username} existiert bereits, ueberspringe.")
            continue

        user_id = str(uuid4())

        # Create user profile
        profile = {
            "id": user_id,
            "username": username,
            "display_name": username,
            "avatar_type": random.choice(AVATAR_TYPES),
            "home_region": user_info["home_region"],
            "is_test_user": True,
            "total_points": 0,
        }

        resp = supabase_post("user_profiles", profile)
        if resp.status_code not in (200, 201):
            print(f"  [{i+1}/{len(all_users)}] FEHLER bei {username}: {resp.text[:200]}")
            continue

        created_users += 1

        # Generate summits
        home_peaks = peaks_cache.get(region_key, [])
        if not home_peaks:
            # Fallback: use any region that has peaks
            for fallback_key, fallback_peaks in peaks_cache.items():
                if fallback_peaks:
                    home_peaks = fallback_peaks
                    break

        if not home_peaks:
            print(f"  [{i+1}/{len(all_users)}] {username} erstellt (keine Gipfel verfuegbar)")
            continue

        # Home region: 3-25 summits
        num_home = random.randint(3, 25)
        # Neighbor region: 0-5 summits
        num_neighbor = random.randint(0, 5)

        summit_records = []
        visited_peaks = {}  # peak_id -> set of seasons
        user_total_points = 0

        # Home region summits
        for _ in range(num_home):
            peak = random.choice(home_peaks)
            season = "2025" if random.random() < 0.80 else "2026"

            peak_seasons = visited_peaks.setdefault(peak["id"], set())
            is_personal_first = peak["id"] not in visited_peaks or len(peak_seasons) == 0
            # After first check, it's in visited_peaks, so re-check properly
            if len(peak_seasons) == 0:
                is_personal_first = True
            else:
                is_personal_first = False

            is_season_first = season not in peak_seasons
            peak_seasons.add(season)

            record = generate_summit_record(
                user_id, peak, season, is_season_first, is_personal_first
            )
            summit_records.append(record)
            user_total_points += record["points"]

        # Neighbor region summits
        neighbors = NEIGHBOR_REGIONS.get(region_key, [])
        for _ in range(num_neighbor):
            if not neighbors:
                break
            neighbor_key = random.choice(neighbors)
            neighbor_peaks = peaks_cache.get(neighbor_key, [])
            if not neighbor_peaks:
                continue
            peak = random.choice(neighbor_peaks)
            season = "2025" if random.random() < 0.80 else "2026"

            peak_seasons = visited_peaks.setdefault(peak["id"], set())
            is_personal_first = len(peak_seasons) == 0
            is_season_first = season not in peak_seasons
            peak_seasons.add(season)

            record = generate_summit_record(
                user_id, peak, season, is_season_first, is_personal_first
            )
            summit_records.append(record)
            user_total_points += record["points"]

        # Insert summits in batches (Supabase has payload limits)
        batch_size = 50
        for b in range(0, len(summit_records), batch_size):
            batch = summit_records[b:b + batch_size]
            supabase_post("summits", batch)

        total_summits += len(summit_records)

        # Update total_points on user profile
        supabase_patch(
            "user_profiles",
            {"id": f"eq.{user_id}"},
            {"total_points": user_total_points},
        )

        print(
            f"  [{i+1}/{len(all_users)}] {username}: "
            f"{len(summit_records)} Gipfel, {user_total_points} Punkte"
        )

    print(f"\n--- Fertig ---")
    print(f"Neue User erstellt: {created_users}")
    print(f"Summits erstellt:   {total_summits}")


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------
def delete_test_data():
    """Delete all test users and their summits."""
    if not check_test_user_column():
        sys.exit(1)

    # Get test user IDs
    test_users = supabase_get("user_profiles", {
        "is_test_user": "eq.true",
        "select": "id,username",
    })

    if not test_users:
        print("Keine Test-User gefunden.")
        return

    print(f"Gefunden: {len(test_users)} Test-User")

    # Delete summits for each user (cascade should handle this, but be explicit)
    for i, user in enumerate(test_users):
        uid = user["id"]
        supabase_delete("summits", {"user_id": f"eq.{uid}"})
        supabase_delete("ownership", {"user_id": f"eq.{uid}"})
        supabase_delete("badges", {"user_id": f"eq.{uid}"})
        if (i + 1) % 20 == 0:
            print(f"  Summits/Badges geloescht fuer {i+1}/{len(test_users)} User...")

    # Delete user profiles
    supabase_delete("user_profiles", {"is_test_user": "eq.true"})

    print(f"\nGeloescht: {len(test_users)} Test-User und alle zugehoerigen Daten.")


# ---------------------------------------------------------------------------
# COUNT
# ---------------------------------------------------------------------------
def count_test_data():
    """Show how many test users and summits exist."""
    if not check_test_user_column():
        sys.exit(1)

    test_users = supabase_get("user_profiles", {
        "is_test_user": "eq.true",
        "select": "id,username,total_points",
        "order": "total_points.desc",
    })

    if not test_users:
        print("Keine Test-User vorhanden.")
        return

    print(f"Test-User: {len(test_users)}")

    # Count summits
    total_summits = 0
    for user in test_users:
        summits = supabase_get("summits", {
            "user_id": f"eq.{user['id']}",
            "select": "id",
        })
        total_summits += len(summits)

    print(f"Test-Summits: {total_summits}")
    print(f"\nTop 10 Test-User nach Punkten:")
    for u in test_users[:10]:
        print(f"  {u['username']:25s} {u['total_points']:>6d} Pkt")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Gipfelkoenig Test-Daten Generator"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--create", action="store_true", help="Erstelle 100 Test-User mit Summits")
    group.add_argument("--delete", action="store_true", help="Loesche alle Test-Daten")
    group.add_argument("--count", action="store_true", help="Zeige Anzahl Test-User/Summits")
    args = parser.parse_args()

    if not SUPABASE_KEY:
        print("FEHLER: SUPABASE_SERVICE_KEY Umgebungsvariable nicht gesetzt!")
        print("  export SUPABASE_SERVICE_KEY='eyJ...'")
        sys.exit(1)

    print(f"Supabase URL: {SUPABASE_URL}")
    print(f"REST API:     {REST_BASE}")
    print()

    if args.create:
        create_test_data()
    elif args.delete:
        delete_test_data()
    elif args.count:
        count_test_data()


if __name__ == "__main__":
    main()
