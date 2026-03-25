#!/usr/bin/env python3
"""
Fix Test Summits — Bergkoenig
==============================
Loescht alle bestehenden Test-User-Summits und erstellt neue mit
realistischen saisonalen Regeln (Schneelinie, Skitourenbereich etc.).

Usage:
  python fix-test-summits.py
"""

import random
import sys
import time
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
SUPABASE_URL = "https://wbrvkweezbeakfphssxp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc"
REST_BASE = f"{SUPABASE_URL}/rest/v1"

# ---------------------------------------------------------------------------
# Snow line by month (meters) — approximate for the Alps
# ---------------------------------------------------------------------------
SNOW_LINE = {
    1: 800,
    2: 900,
    3: 1200,
    4: 1500,
    5: 2000,
    6: 2500,
    7: 3500,
    8: 3500,
    9: 3500,
    10: 2500,
    11: 1500,
    12: 1000,
}

# Ski touring range
SKI_TOUR_MIN = 1500
SKI_TOUR_MAX = 2800

# Hard limits
PEAK_MIN_ELEVATION = 300
PEAK_MAX_ELEVATION = 3500

# ---------------------------------------------------------------------------
# Checkin method weights
# ---------------------------------------------------------------------------
CHECKIN_METHODS = [
    ("strava", 0.60),
    ("manual", 0.25),
    ("suunto", 0.10),
    ("gpx_upload", 0.05),
]

# ---------------------------------------------------------------------------
# Activity types (summit count ranges) — 100 total slots
# ---------------------------------------------------------------------------
ACTIVITY_POOL = (
    [("hardcore", 20, 30)] * 5
    + [("active", 10, 19)] * 15
    + [("regular", 5, 9)] * 35
    + [("casual", 2, 4)] * 30
    + [("newbie", 1, 1)] * 15
)

# ---------------------------------------------------------------------------
# Regional bounds (same as create-test-data.py)
# ---------------------------------------------------------------------------
REGIONS = {
    "oberallgaeu": {
        "count": 30,
        "lat_min": 47.30, "lat_max": 47.50,
        "lng_min": 10.15, "lng_max": 10.50,
    },
    "tirol": {
        "count": 20,
        "lat_min": 47.15, "lat_max": 47.35,
        "lng_min": 10.80, "lng_max": 11.60,
    },
    "bregenzerwald": {
        "count": 10,
        "lat_min": 47.30, "lat_max": 47.50,
        "lng_min": 9.80, "lng_max": 10.10,
    },
    "kleinwalsertal": {
        "count": 8,
        "lat_min": 47.30, "lat_max": 47.38,
        "lng_min": 10.05, "lng_max": 10.22,
    },
    "oberengadin": {
        "count": 10,
        "lat_min": 46.40, "lat_max": 46.60,
        "lng_min": 9.70, "lng_max": 10.10,
    },
    "salzburg": {
        "count": 10,
        "lat_min": 47.10, "lat_max": 47.40,
        "lng_min": 12.80, "lng_max": 13.20,
    },
    "berner_oberland": {
        "count": 5,
        "lat_min": 46.50, "lat_max": 46.70,
        "lng_min": 7.80, "lng_max": 8.20,
    },
    "multi_region": {
        "count": 7,
    },
}


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def get_headers(minimal=True):
    h = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if minimal:
        h["Prefer"] = "return=minimal"
    else:
        h["Prefer"] = "return=representation"
    return h


def supabase_get(table, query_string=""):
    url = f"{REST_BASE}/{table}"
    if query_string:
        url = f"{url}?{query_string}"
    resp = requests.get(url, headers=get_headers(minimal=False))
    resp.raise_for_status()
    return resp.json()


def supabase_post(table, data):
    url = f"{REST_BASE}/{table}"
    resp = requests.post(url, headers=get_headers(minimal=True), json=data)
    if resp.status_code not in (200, 201):
        print(f"  FEHLER POST {table}: {resp.status_code} {resp.text[:300]}")
    return resp


def supabase_patch(table, match_params, data):
    url = f"{REST_BASE}/{table}"
    headers = get_headers(minimal=True)
    resp = requests.patch(url, headers=headers, params=match_params, json=data)
    if resp.status_code not in (200, 204):
        print(f"  FEHLER PATCH {table}: {resp.status_code} {resp.text[:300]}")
    return resp


def supabase_delete(table, params):
    url = f"{REST_BASE}/{table}"
    resp = requests.delete(url, headers=get_headers(minimal=True), params=params)
    if resp.status_code not in (200, 204):
        print(f"  FEHLER DELETE {table}: {resp.status_code} {resp.text[:300]}")
    return resp


# ---------------------------------------------------------------------------
# Peak loading
# ---------------------------------------------------------------------------
def fetch_peaks_for_region(region_key):
    r = REGIONS[region_key]
    qs = (
        f"select=id,name,elevation,lat,lng"
        f"&lat=gte.{r['lat_min']}&lat=lte.{r['lat_max']}"
        f"&lng=gte.{r['lng_min']}&lng=lte.{r['lng_max']}"
        f"&limit=500"
    )
    url = f"{REST_BASE}/peaks?{qs}"
    resp = requests.get(url, headers=get_headers(minimal=False))
    if resp.status_code != 200:
        print(f"  Warnung: Peaks laden fuer {region_key} fehlgeschlagen: {resp.status_code}")
        return []
    return resp.json()


# ---------------------------------------------------------------------------
# Seasonal filtering
# ---------------------------------------------------------------------------
def is_peak_accessible(peak_elevation, month):
    """
    Prueft ob ein Gipfel im gegebenen Monat realistisch erreichbar ist.
    Gibt (accessible, is_ski_tour) zurueck.
    """
    if peak_elevation is None:
        return False, False

    # Hard limits — keine extremen Gipfel, keine Huegel
    if peak_elevation > PEAK_MAX_ELEVATION or peak_elevation < PEAK_MIN_ELEVATION:
        return False, False

    snow_line = SNOW_LINE[month]

    # Winter (Dec-Mar): nur Skitouren im Bereich 1500-2800m
    if month in (12, 1, 2, 3):
        if SKI_TOUR_MIN <= peak_elevation <= SKI_TOUR_MAX:
            # Ski touring accessible if elevation < snow_line + 1500
            if peak_elevation < snow_line + 1500:
                return True, True
        # Low peaks below snow line are also walkable in winter
        if peak_elevation < snow_line:
            return True, False
        return False, False

    # Spring (Apr-May): Peaks under the snow line
    if month in (4, 5):
        if peak_elevation < snow_line:
            return True, False
        return False, False

    # Summer (Jun-Sep): Anything up to snow line
    if month in (6, 7, 8, 9):
        if peak_elevation <= snow_line:
            return True, False
        return False, False

    # Autumn (Oct-Nov): Peaks under snow line
    if month in (10, 11):
        if peak_elevation < snow_line:
            return True, False
        return False, False

    return False, False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def pick_checkin_method():
    r = random.random()
    cumulative = 0.0
    for method, weight in CHECKIN_METHODS:
        cumulative += weight
        if r < cumulative:
            return method
    return "manual"


def random_date_weighted():
    """70% chance 2025, 30% chance 2026 Jan-Mar."""
    if random.random() < 0.70:
        # Random date in 2025
        start = datetime(2025, 1, 1)
        end = datetime(2025, 12, 31)
    else:
        # Random date in 2026 Jan-Mar
        start = datetime(2026, 1, 1)
        end = datetime(2026, 3, 25)
    delta_days = (end - start).days
    day = start + timedelta(days=random.randint(0, delta_days))
    hour = random.randint(6, 19)
    minute = random.randint(0, 59)
    return day.replace(hour=hour, minute=minute, second=0)


# ---------------------------------------------------------------------------
# Assign users to regions deterministically based on sorted user list
# ---------------------------------------------------------------------------
def assign_users_to_regions(test_users):
    """
    Assign each test user to a region based on the REGIONS count distribution.
    Users are sorted by username for deterministic assignment.
    """
    sorted_users = sorted(test_users, key=lambda u: u["username"])
    assignments = []
    idx = 0
    region_keys = [k for k in REGIONS if k != "multi_region"]

    for region_key in region_keys:
        count = REGIONS[region_key]["count"]
        for _ in range(count):
            if idx < len(sorted_users):
                assignments.append((sorted_users[idx], region_key))
                idx += 1

    # Multi-region for remaining users
    while idx < len(sorted_users):
        assignments.append((sorted_users[idx], "multi_region"))
        idx += 1

    return assignments


# ===========================================================================
# MAIN
# ===========================================================================
def main():
    print("=" * 60)
    print("Bergkoenig — Fix Test Summits")
    print("=" * 60)
    print(f"Supabase URL: {SUPABASE_URL}")
    print()

    # ------------------------------------------------------------------
    # STEP 1: Get test users
    # ------------------------------------------------------------------
    print("Schritt 1: Lade Test-User...")
    test_users = supabase_get("user_profiles", "is_test_user=eq.true&select=id,username")
    if not test_users:
        print("Keine Test-User gefunden! Abbruch.")
        sys.exit(1)
    print(f"  Gefunden: {len(test_users)} Test-User\n")

    # ------------------------------------------------------------------
    # STEP 2: Delete ALL existing summits for test users
    # ------------------------------------------------------------------
    print("Schritt 2: Loesche ALLE bestehenden Test-User-Summits...")
    for i, user in enumerate(test_users):
        uid = user["id"]
        supabase_delete("summits", {"user_id": f"eq.{uid}"})
        if (i + 1) % 20 == 0:
            print(f"  Summits geloescht fuer {i+1}/{len(test_users)} User...")
    print(f"  Alle Test-User-Summits geloescht.\n")

    # ------------------------------------------------------------------
    # STEP 3: Load peaks per region
    # ------------------------------------------------------------------
    print("Schritt 3: Lade Gipfel pro Region...")
    peaks_cache = {}
    for region_key in REGIONS:
        if region_key == "multi_region":
            continue
        peaks = fetch_peaks_for_region(region_key)
        peaks_cache[region_key] = peaks
        print(f"  {region_key}: {len(peaks)} Gipfel")
    print()

    # ------------------------------------------------------------------
    # STEP 4: Assign users to regions and activity types
    # ------------------------------------------------------------------
    print("Schritt 4: Weise Regionen und Aktivitaetstypen zu...")
    assignments = assign_users_to_regions(test_users)

    # Shuffle activity pool and assign
    activity_pool = list(ACTIVITY_POOL)
    random.shuffle(activity_pool)

    # If fewer users than 100, trim the pool
    activity_pool = activity_pool[:len(assignments)]

    # ------------------------------------------------------------------
    # STEP 5: Generate realistic summits
    # ------------------------------------------------------------------
    print(f"\nSchritt 5: Erstelle neue Summits mit saisonalen Regeln...\n")

    # Global tracker for season_first: (peak_id, season) -> True
    global_season_summits = set()
    total_summits = 0
    all_user_points = {}
    skipped_no_peaks = 0

    for i, ((user, region_key), (activity_label, min_s, max_s)) in enumerate(
        zip(assignments, activity_pool)
    ):
        user_id = user["id"]
        username = user["username"]
        num_summits = random.randint(min_s, max_s)

        # Determine available peaks for this user
        if region_key == "multi_region":
            available_regions = [k for k in peaks_cache if peaks_cache[k]]
            if len(available_regions) < 2:
                skipped_no_peaks += 1
                continue
            chosen = random.sample(available_regions, min(random.randint(2, 3), len(available_regions)))
            user_peaks = []
            for rk in chosen:
                user_peaks.extend(peaks_cache[rk])
        else:
            user_peaks = peaks_cache.get(region_key, [])

        if not user_peaks:
            print(f"  [{i+1:3d}/{len(assignments)}] {username:25s} | {region_key:18s} | KEINE GIPFEL")
            skipped_no_peaks += 1
            all_user_points[user_id] = 0
            continue

        # Generate summit records
        user_summit_records = []
        user_peak_count = {}
        user_summited_peaks = set()
        user_total_points = 0
        consecutive_failures = 0

        for _ in range(num_summits * 5):  # Try up to 5x to get enough summits
            if len(user_summit_records) >= num_summits:
                break

            # Pick a random date
            summit_date = random_date_weighted()
            month = summit_date.month

            # Pick a random peak and check seasonal accessibility
            attempts = 0
            peak = None
            is_ski = False
            while attempts < 30:
                candidate = random.choice(user_peaks)
                elev = candidate.get("elevation")
                if elev is None:
                    attempts += 1
                    continue
                accessible, ski = is_peak_accessible(elev, month)
                if accessible and user_peak_count.get(candidate["id"], 0) < 3:
                    peak = candidate
                    is_ski = ski
                    break
                attempts += 1

            if peak is None:
                consecutive_failures += 1
                if consecutive_failures > 20:
                    break  # Region probably has no suitable peaks
                continue

            consecutive_failures = 0
            user_peak_count[peak["id"]] = user_peak_count.get(peak["id"], 0) + 1

            elevation = peak["elevation"]
            season = str(summit_date.year)

            # Elevation gain — ski tours tend to have higher gain ratio
            if is_ski:
                elevation_gain = round(elevation * random.uniform(0.5, 0.85))
            else:
                elevation_gain = round(elevation * random.uniform(0.3, 0.75))

            # Distance
            if is_ski:
                distance = round(elevation_gain / 100 * random.uniform(1.0, 2.0), 1)
            else:
                distance = round(elevation_gain / 100 * random.uniform(1.2, 2.8), 1)

            # Points
            base_points = round(elevation_gain / 100) + round(distance) + 10

            season_key = (peak["id"], season)
            is_season_first = season_key not in global_season_summits
            is_personal_first = peak["id"] not in user_summited_peaks

            if is_season_first:
                points = round(base_points * 3)
            elif is_personal_first:
                points = round(base_points * 2)
            else:
                points = round(base_points * 0.2)

            global_season_summits.add(season_key)
            user_summited_peaks.add(peak["id"])

            record = {
                "id": str(uuid4()),
                "user_id": user_id,
                "peak_id": peak["id"],
                "summited_at": summit_date.isoformat(),
                "season": season,
                "elevation_gain": elevation_gain,
                "distance": distance,
                "points": points,
                "checkin_method": pick_checkin_method(),
                "is_season_first": is_season_first,
                "is_personal_first": is_personal_first,
            }

            user_summit_records.append(record)
            user_total_points += points

        # Insert summits in batches of 50
        for b in range(0, len(user_summit_records), 50):
            batch = user_summit_records[b:b + 50]
            supabase_post("summits", batch)

        total_summits += len(user_summit_records)
        all_user_points[user_id] = user_total_points

        print(
            f"  [{i+1:3d}/{len(assignments)}] {username:25s} | {region_key:18s} | "
            f"{activity_label:10s} | {len(user_summit_records):2d} Gipfel | "
            f"{user_total_points:5d} Pkt"
        )

    # ------------------------------------------------------------------
    # STEP 6: Update total_points for each test user
    # ------------------------------------------------------------------
    print(f"\nSchritt 6: Aktualisiere total_points fuer alle Test-User...")
    for user_id, total_pts in all_user_points.items():
        supabase_patch(
            "user_profiles",
            {"id": f"eq.{user_id}"},
            {"total_points": total_pts},
        )
    print(f"  Punkte aktualisiert fuer {len(all_user_points)} User.\n")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print("=" * 60)
    print("FERTIG — Zusammenfassung")
    print("=" * 60)
    print(f"  Test-User:              {len(test_users)}")
    print(f"  Summits erstellt:       {total_summits}")
    print(f"  User ohne Gipfel:       {skipped_no_peaks}")
    avg = total_summits / len(test_users) if test_users else 0
    print(f"  Durchschnitt/User:      {avg:.1f}")
    total_pts = sum(all_user_points.values())
    print(f"  Gesamtpunkte:           {total_pts}")
    print("=" * 60)


if __name__ == "__main__":
    main()
