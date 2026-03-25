#!/usr/bin/env python3
"""
Gipfelkoenig Test Data Generator
=================================
Erstellt 100 Test-User mit realistischen Gipfeldaten.

Usage:
  python create-test-data.py --create   # Erstelle alle Testdaten
  python create-test-data.py --delete   # Loesche alle Testdaten (is_test_user = true)
  python create-test-data.py --count    # Zeige Statistiken
"""

import argparse
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
SUPABASE_URL = "https://wbrvkweezbeakfphssxp.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
REST_BASE = f"{SUPABASE_URL}/rest/v1"

# ---------------------------------------------------------------------------
# Avatar types
# ---------------------------------------------------------------------------
AVATAR_TYPES = ["mountain", "eagle", "ski", "climber", "tree", "snow", "deer", "rock"]

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
# 100 Test Users: 75 male, 25 female
# ---------------------------------------------------------------------------
MALE_REALISTIC = [
    "Hans Müller", "Pirmin Schlegel", "Tobias Berger", "Stefan Walser", "Marco Alber",
    "Lukas Fink", "Andreas Hofer", "Thomas Kessler", "Martin Bühler", "Reto Capaul",
    "Fritz Berchtold", "Werner Moser", "Kurt Steiner", "Peter Huber", "Markus Schneider",
    "Roland Fischer", "Simon Brunner", "Patrick Zimmermann", "Daniel Koller", "Florian Weber",
    "Christian Mayer", "Michael Gruber", "Alexander Wirth", "Sebastian Pichler", "Hannes Egger",
    "Matthias Schwarz", "Dominik Fuchs", "Benjamin Wolf", "Julian Auer", "Oliver Hartmann",
    "Jakob Braun", "Felix Sommer", "Nikolaus Lechner", "Georg Bauer", "Josef Reiter",
    "Johann Maier", "Klaus Neumann", "Dieter Hoffmann", "Helmut Schuster", "Erwin Kofler",
    "Paul Riedl", "Ernst Grabner", "Ludwig Wieser", "Manfred Thurner", "Gerhard Zangerl",
    "Norbert Peer", "Anton Schranz", "Rudolf Plattner", "Herbert Tanzer", "Siegfried Larcher",
    # 10 more to reach 60
    "Walter Auer", "Heinrich Mair", "Friedrich Huber", "Otto Berger", "Gustav Lehner",
    "Karl Stadler", "Bernhard Eder", "Erich Winkler", "Alfred Holzer", "Hugo Pfeifer",
]

FEMALE_REALISTIC = [
    "Anna Steiner", "Lisa Berchtold", "Sandra Müller", "Julia Walser", "Kathrin Moser",
    "Maria Huber", "Simone Fehr", "Elena Bianchi", "Claudia Fischer", "Martina Gruber",
    "Laura Schneider", "Stefanie Weber", "Nina Brunner", "Sonja Mayer", "Petra Schwarz",
    "Monika Egger", "Christine Wolf", "Susanne Braun", "Daniela Sommer", "Verena Koller",
]

MALE_FANTASY = [
    "Sugus", "Bergsteiger", "PRS25", "AlpinFuchs", "GipfelJäger",
    "TrailWolf", "BergNomad", "Höhenmeter", "Schneeleopard", "Steinadler",
    "Gämse007", "MountainGoat", "KletterMax", "WandererX", "Yeti2025",
]

FEMALE_FANTASY = [
    "TrailQueen", "BergFee", "AlpenRose", "GipfelHexe", "Edelweiss",
]

ALL_USERS = (
    [(name, "m", "realistic") for name in MALE_REALISTIC]
    + [(name, "f", "realistic") for name in FEMALE_REALISTIC]
    + [(name, "m", "fantasy") for name in MALE_FANTASY]
    + [(name, "f", "fantasy") for name in FEMALE_FANTASY]
)

assert len(ALL_USERS) == 100, f"Erwartet 100 User, aber {len(ALL_USERS)} definiert"

# ---------------------------------------------------------------------------
# Regional distribution with lat/lng bounds
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
# Activity types (summit count ranges)
# ---------------------------------------------------------------------------
ACTIVITY_POOL = (
    [("hardcore", 20, 30)] * 5
    + [("active", 10, 19)] * 15
    + [("regular", 5, 9)] * 35
    + [("casual", 2, 4)] * 30
    + [("newbie", 1, 1)] * 15
)

assert len(ACTIVITY_POOL) == 100, f"Erwartet 100 Aktivitaetstypen, aber {len(ACTIVITY_POOL)}"


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def get_headers(minimal=True):
    """Return Supabase REST API headers."""
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
    """GET request mit manuellem Query-String (fuer doppelte Spaltenfilter)."""
    url = f"{REST_BASE}/{table}"
    if query_string:
        url = f"{url}?{query_string}"
    resp = requests.get(url, headers=get_headers(minimal=False))
    resp.raise_for_status()
    return resp.json()


def supabase_post(table, data):
    """POST (insert) to Supabase REST API. Gibt Status zurueck."""
    url = f"{REST_BASE}/{table}"
    resp = requests.post(url, headers=get_headers(minimal=True), json=data)
    if resp.status_code not in (200, 201):
        print(f"  FEHLER POST {table}: {resp.status_code} {resp.text[:300]}")
    return resp


def supabase_patch(table, match_params, data):
    """PATCH (update) rows matching params."""
    url = f"{REST_BASE}/{table}"
    headers = get_headers(minimal=True)
    resp = requests.patch(url, headers=headers, params=match_params, json=data)
    if resp.status_code not in (200, 204):
        print(f"  FEHLER PATCH {table}: {resp.status_code} {resp.text[:300]}")
    return resp


def supabase_delete(table, params):
    """DELETE rows matching params."""
    url = f"{REST_BASE}/{table}"
    resp = requests.delete(url, headers=get_headers(minimal=True), params=params)
    if resp.status_code not in (200, 204):
        print(f"  FEHLER DELETE {table}: {resp.status_code} {resp.text[:300]}")
    return resp


# ---------------------------------------------------------------------------
# Peaks laden und cachen
# ---------------------------------------------------------------------------
def fetch_peaks_for_region(region_key):
    """Lade Peaks innerhalb der lat/lng Bounds einer Region."""
    r = REGIONS[region_key]
    qs = (
        f"select=id,name,elevation,lat,lng"
        f"&lat=gte.{r['lat_min']}&lat=lte.{r['lat_max']}"
        f"&lng=gte.{r['lng_min']}&lng=lte.{r['lng_max']}"
        f"&limit=200"
    )
    url = f"{REST_BASE}/peaks?{qs}"
    resp = requests.get(url, headers=get_headers(minimal=False))
    if resp.status_code != 200:
        print(f"  Warnung: Peaks laden fuer {region_key} fehlgeschlagen: {resp.status_code}")
        return []
    return resp.json()


# ---------------------------------------------------------------------------
# User auf Regionen verteilen
# ---------------------------------------------------------------------------
def assign_users_to_regions():
    """Verteile die 100 User zufaellig auf Regionen gemaess count."""
    shuffled = list(ALL_USERS)
    random.shuffle(shuffled)

    assignments = []
    idx = 0
    region_keys = [k for k in REGIONS if k != "multi_region"]

    for region_key in region_keys:
        count = REGIONS[region_key]["count"]
        for _ in range(count):
            name, gender, name_type = shuffled[idx]
            assignments.append((name, gender, name_type, region_key))
            idx += 1

    # Multi-Region: verbleibende 7 User
    for i in range(REGIONS["multi_region"]["count"]):
        name, gender, name_type = shuffled[idx]
        assignments.append((name, gender, name_type, "multi_region"))
        idx += 1

    assert idx == 100, f"Nur {idx} User zugewiesen statt 100"
    return assignments


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------
def pick_checkin_method():
    """Zufaellige Checkin-Methode gemaess Gewichtung."""
    r = random.random()
    cumulative = 0.0
    for method, weight in CHECKIN_METHODS:
        cumulative += weight
        if r < cumulative:
            return method
    return "manual"


def random_datetime_in_season(season):
    """Zufaelliger Zeitpunkt innerhalb einer Saison (06:00-20:00)."""
    year = int(season)
    if year == 2025:
        start = datetime(2025, 1, 1)
        end = datetime(2025, 12, 31)
    else:
        start = datetime(2026, 1, 1)
        end = datetime(2026, 3, 25)
    delta_days = (end - start).days
    if delta_days <= 0:
        delta_days = 1
    day = start + timedelta(days=random.randint(0, delta_days))
    hour = random.randint(6, 19)
    minute = random.randint(0, 59)
    return day.replace(hour=hour, minute=minute, second=0)


def make_username(name, name_type):
    """Erzeuge DB-Username: Leerzeichen durch _ ersetzen."""
    if name_type == "fantasy":
        return name  # Kein Leerzeichen
    return name.replace(" ", "_")


# ---------------------------------------------------------------------------
# CREATE
# ---------------------------------------------------------------------------
def create_test_data():
    """Erstelle 100 Test-User mit Summit-Daten."""
    # Existierende Test-User pruefen
    existing = supabase_get("user_profiles", "is_test_user=eq.true&select=id,username")
    existing_usernames = {u["username"] for u in existing}
    if existing_usernames:
        print(f"Bereits {len(existing_usernames)} Test-User vorhanden, ueberspringe diese.\n")

    # Peaks pro Region laden und cachen
    print("Lade Gipfel pro Region...")
    peaks_cache = {}
    for region_key in REGIONS:
        if region_key == "multi_region":
            continue
        peaks = fetch_peaks_for_region(region_key)
        peaks_cache[region_key] = peaks
        print(f"  {region_key}: {len(peaks)} Gipfel")

    empty_regions = [k for k, v in peaks_cache.items() if not v]
    if empty_regions:
        print(f"\n  Warnung: Keine Gipfel in: {', '.join(empty_regions)}\n")

    # User auf Regionen verteilen
    assignments = assign_users_to_regions()

    # Activity-Typen zufaellig zuweisen
    activity_pool = list(ACTIVITY_POOL)
    random.shuffle(activity_pool)

    # Globale Tracker fuer season_first
    # Key: (peak_id, season) -> True wenn schon von jemandem bestiegen
    global_season_summits = set()

    created_users = 0
    total_summits = 0
    all_user_points = {}  # user_id -> total_points
    all_summit_records = []

    print(f"\nErstelle {len(assignments)} Test-User...\n")

    for i, (name, gender, name_type, region_key) in enumerate(assignments):
        username = make_username(name, name_type)
        display_name = name
        activity_label, min_summits, max_summits = activity_pool[i]
        num_summits = random.randint(min_summits, max_summits)

        # Ueberspringe existierende User
        if username in existing_usernames:
            print(f"  [{i+1:3d}/100] {username} existiert bereits, ueberspringe.")
            continue

        # 1. Auth-User via Admin API erstellen
        email = f"test_{username.lower().replace(' ','')}@bergkoenig.test"
        auth_headers = get_headers()
        auth_resp = requests.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=auth_headers,
            json={
                "email": email,
                "password": "BergTest2026!",
                "email_confirm": True,
                "user_metadata": {"is_test_user": True}
            }
        )
        if auth_resp.status_code != 200:
            print(f"  [{i+1:3d}/100] AUTH FEHLER bei {username}: {auth_resp.text[:100]}")
            continue

        user_id = auth_resp.json()["id"]

        # 2. User-Profil erstellen
        profile = {
            "id": user_id,
            "username": username,
            "display_name": display_name,
            "avatar_type": random.choice(AVATAR_TYPES),
            "is_test_user": True,
            "total_points": 0,
        }

        resp = supabase_post("user_profiles", profile)
        if resp.status_code not in (200, 201):
            print(f"  [{i+1:3d}/100] PROFIL FEHLER bei {username}: {resp.text[:100]}")
            # Auth-User wieder loeschen
            requests.delete(f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}", headers=get_headers())
            continue

        created_users += 1

        # Peaks fuer diesen User bestimmen
        if region_key == "multi_region":
            # Multi-Region: 2-3 zufaellige Regionen
            available_regions = [k for k in peaks_cache if peaks_cache[k]]
            if len(available_regions) < 2:
                print(f"  [{i+1:3d}/100] {username}: zu wenige Regionen mit Peaks")
                continue
            chosen_regions = random.sample(available_regions, min(random.randint(2, 3), len(available_regions)))
            user_peaks = []
            for rk in chosen_regions:
                user_peaks.extend(peaks_cache[rk])
        else:
            user_peaks = peaks_cache.get(region_key, [])

        if not user_peaks:
            print(f"  [{i+1:3d}/100] {username} erstellt (keine Gipfel in Region {region_key})")
            continue

        # Summits generieren
        user_summit_records = []
        user_peak_count = {}  # peak_id -> Anzahl Besteigungen
        user_summited_peaks = set()  # Fuer is_personal_first
        user_total_points = 0

        for _ in range(num_summits):
            # Peak waehlen (max 3x pro User)
            attempts = 0
            while attempts < 20:
                peak = random.choice(user_peaks)
                if user_peak_count.get(peak["id"], 0) < 3:
                    break
                attempts += 1
            else:
                # Kein passender Peak gefunden, ueberspringe
                continue

            user_peak_count[peak["id"]] = user_peak_count.get(peak["id"], 0) + 1

            # Season: 70% 2025, 30% 2026
            season = "2025" if random.random() < 0.70 else "2026"
            summited_at = random_datetime_in_season(season)

            # Elevation gain und Distance
            elevation = peak.get("elevation")
            if elevation:
                elevation_gain = round(elevation * random.uniform(0.3, 0.8))
            else:
                elevation_gain = random.randint(400, 1500)

            distance = round(elevation_gain / 100 * random.uniform(1.2, 2.8), 1)

            # Punkte berechnen
            base_points = round(elevation_gain / 100) + round(distance) + 10

            # Season-First und Personal-First pruefen
            season_key = (peak["id"], season)
            is_season_first = season_key not in global_season_summits
            is_personal_first = peak["id"] not in user_summited_peaks

            # Multiplier anwenden
            if is_season_first:
                points = round(base_points * 3)
            elif is_personal_first:
                points = round(base_points * 2)
            else:
                points = round(base_points * 0.2)

            # Tracker aktualisieren
            global_season_summits.add(season_key)
            user_summited_peaks.add(peak["id"])

            record = {
                "id": str(uuid4()),
                "user_id": user_id,
                "peak_id": peak["id"],
                "summited_at": summited_at.isoformat(),
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

        # Summits in Batches von 50 einfuegen
        for b in range(0, len(user_summit_records), 50):
            batch = user_summit_records[b:b + 50]
            supabase_post("summits", batch)

        total_summits += len(user_summit_records)
        all_user_points[user_id] = user_total_points

        print(
            f"  [{i+1:3d}/100] {username:25s} | {region_key:18s} | "
            f"{activity_label:10s} | {len(user_summit_records):2d} Gipfel | "
            f"{user_total_points:5d} Pkt"
        )

    # Total Points pro User updaten
    print("\nAktualisiere total_points fuer alle Test-User...")
    for user_id, total_pts in all_user_points.items():
        supabase_patch(
            "user_profiles",
            {"id": f"eq.{user_id}"},
            {"total_points": total_pts},
        )

    print(f"\n{'='*60}")
    print(f"FERTIG")
    print(f"  Neue User erstellt:  {created_users}")
    print(f"  Summits erstellt:    {total_summits}")
    print(f"{'='*60}")


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------
def delete_test_data():
    """Loesche alle Test-User und deren Summits."""
    # Test-User IDs holen
    test_users = supabase_get("user_profiles", "is_test_user=eq.true&select=id,username")

    if not test_users:
        print("Keine Test-User gefunden.")
        return

    print(f"Gefunden: {len(test_users)} Test-User\n")

    # Summits fuer jeden User loeschen
    for i, user in enumerate(test_users):
        uid = user["id"]
        supabase_delete("summits", {"user_id": f"eq.{uid}"})
        if (i + 1) % 10 == 0:
            print(f"  Summits geloescht fuer {i+1}/{len(test_users)} User...")

    print(f"  Alle Summits geloescht.")

    # User-Profile loeschen
    supabase_delete("user_profiles", {"is_test_user": "eq.true"})
    print(f"  Alle {len(test_users)} Test-User-Profile geloescht.")

    # Auth-User loeschen
    print("  Loesche Auth-User...")
    for i, user in enumerate(test_users):
        uid = user["id"]
        requests.delete(f"{SUPABASE_URL}/auth/v1/admin/users/{uid}", headers=get_headers())
        if (i + 1) % 10 == 0:
            print(f"  Auth-User geloescht: {i+1}/{len(test_users)}...")
    print(f"  Alle Auth-User geloescht.")

    print(f"\nFertig: {len(test_users)} Test-User komplett entfernt (Auth + Profil + Summits).")


# ---------------------------------------------------------------------------
# COUNT
# ---------------------------------------------------------------------------
def count_test_data():
    """Zeige Statistiken zu Test-Usern und Summits."""
    test_users = supabase_get(
        "user_profiles",
        "is_test_user=eq.true&select=id,username,total_points&order=total_points.desc"
    )

    if not test_users:
        print("Keine Test-User vorhanden.")
        return

    print(f"Test-User gesamt: {len(test_users)}\n")

    # Summits zaehlen (Stichprobe der ersten 10 User fuer schnelle Anzeige)
    total_summits = 0
    for user in test_users:
        summits = supabase_get("summits", f"user_id=eq.{user['id']}&select=id")
        total_summits += len(summits)

    print(f"Test-Summits gesamt: {total_summits}")
    avg = total_summits / len(test_users) if test_users else 0
    print(f"Durchschnitt Summits/User: {avg:.1f}")

    total_points = sum(u.get("total_points", 0) for u in test_users)
    print(f"Gesamtpunkte aller Test-User: {total_points}")

    print(f"\nTop 15 Test-User nach Punkten:")
    print(f"  {'Username':25s} {'Punkte':>8s}")
    print(f"  {'-'*25} {'-'*8}")
    for u in test_users[:15]:
        print(f"  {u['username']:25s} {u.get('total_points', 0):>8d}")

    print(f"\nBottom 5 Test-User:")
    for u in test_users[-5:]:
        print(f"  {u['username']:25s} {u.get('total_points', 0):>8d}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Gipfelkoenig Test-Daten Generator (100 User)"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--create", action="store_true", help="Erstelle 100 Test-User mit Summits")
    group.add_argument("--delete", action="store_true", help="Loesche alle Test-Daten (is_test_user=true)")
    group.add_argument("--count", action="store_true", help="Zeige Statistiken")
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
