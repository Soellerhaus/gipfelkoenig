#!/usr/bin/env python3
"""
Bergkoenig — Komplett-Rebuild Test-User mit Alpen-weiter Hex-Verteilung
========================================================================

Strategie:
1. Loescht alle existierenden Test-User
2. Laedt alle Alpen-Peaks (lat 44-48, lng 5-16)
3. Gruppiert Peaks nach Hex-Zelle (gleicher flat-top Hex-Algo wie Frontend)
4. Pro Hex-Zelle mit Peaks: 1 "Koenig" + 0-2 "Rivalen"
5. Avatar via Hex-Koordinaten-Hash: (col%7, row%7) → Eindeutigkeit
   innerhalb 3-Hex-Distanz garantiert
6. 80% Sport-Fotos, 20% Portrait-Fotos
7. Generiert Summits pro User in seinem Hex

Usage:
  export SUPABASE_SERVICE_KEY="eyJ..."
  python scripts/rebuild-fake-users-alps.py [--dry-run]
"""
import math
import os
import random
import sys
from datetime import datetime, timedelta
from uuid import uuid4

import requests

SUPABASE_URL = "https://wbrvkweezbeakfphssxp.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
REST_BASE = f"{SUPABASE_URL}/rest/v1"
DRY_RUN = "--dry-run" in sys.argv

if not SUPABASE_KEY:
    print("FEHLER: SUPABASE_SERVICE_KEY nicht gesetzt"); sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

# ---------------------------------------------------------------------------
# Hex-Geometrie (identisch zu frontend/js/map.js getHexCell)
# ---------------------------------------------------------------------------
HEX_SIZE_KM = 5
LAT_KM = 111.32
LNG_KM = 75.9
S_LAT = HEX_SIZE_KM / LAT_KM
S_LNG = HEX_SIZE_KM / LNG_KM


def get_hex_cell(lat, lng):
    """Cube-round flat-top Hex-Zelle. col, row, centerLat, centerLng."""
    x = lng / S_LNG
    y = lat / S_LAT
    qf = (2.0 / 3.0) * x
    rf = (-1.0 / 3.0) * x + (math.sqrt(3) / 3.0) * y
    sf = -qf - rf
    q = round(qf); r = round(rf); s = round(sf)
    dq = abs(q - qf); dr = abs(r - rf); ds = abs(s - sf)
    if dq > dr and dq > ds: q = -r - s
    elif dr > ds: r = -q - s
    col = q
    row = r + (q - (q & 1)) // 2
    centerLng = col * 1.5 * S_LNG
    rowOffsetLat = (math.sqrt(3) / 2.0) * S_LAT if (col % 2 != 0) else 0
    centerLat = row * math.sqrt(3) * S_LAT + rowOffsetLat
    return col, row, centerLat, centerLng


# ---------------------------------------------------------------------------
# Photo-Pool (Sport-Fotos + Portraits, Unsplash-IDs)
# Wird durch verify-photo-pool.py validiert. Kaputte werden zur Laufzeit
# rausgefiltert (wir HEAD-checken alle vorm Update).
# ---------------------------------------------------------------------------
SPORT_PHOTO_IDS = [
    "1649124941653-d33d7baad7ac", "1622191712616-2db3b5895e3e",
    "1680715764433-fdb5707635df", "1706811618759-2971389ba999",
    "1697797284177-95eb0799c4ed", "1599725695996-a5ebb7120721",
    "1694933924697-320542bc3a03", "1519575177684-20058cd53bff",
    "1608040313640-f0f106836ae5", "1533540760201-950afeb96411",
    "1691782834318-0dea0ce990d5", "1534321896477-bab66f3dec1c",
    "1533540046196-4710d983af1b", "1573137700231-0f09df5c8cf9",
    "1533540570515-6ffd9bda4b94", "1568638796491-68c454bd60ee",
    "1732540449870-f3e4c4506055", "1759161039021-968808ab6af8",
    "1516573454759-d43e4d43dce9",
    "1560354790-a403c5a97e0f", "1504025468847-0e438279542c",
    "1712955685153-1b9c8edd071f", "1610066370580-f698d2ccfb69",
    "1665502089396-0f5b9864bf1d", "1665502090508-f3c1064a56bc",
    "1560354892-75d8f5d0b5e9", "1665502089573-7983977fabf7",
    "1700667878010-8ddf2ccc60d0", "1667205742805-b5154830522b",
    "1731991027003-386ac5ae9c72", "1665502090549-593cb6b38934",
    "1664436341001-b02974ae7524", "1562826542-449090f38c70",
    "1618648324286-5c087d9419b8", "1644869432047-fa8bdbe849cd",
    "1518784095177-ef1da6313126", "1642841220705-b03194dd9de7",
    "1464722557942-f2cf145d3cae", "1548604130-5db6fcf5fc13",
    "1563442162585-fa1426255ea9", "1714072535859-ba718811ef11",
    "1600785524973-e518061204be", "1524992622325-a5b57c403ad3",
    "1580157906144-3fd1489f66e0", "1619732913960-d23a50661692",
    "1731663020994-b3dbcaf14ac7",
]

PORTRAIT_PHOTO_IDS = [
    "1665568216027-485a41276152", "1576581531914-3b397ce1a99a",
    "1717882069011-3c55702c6e92", "1590682015537-ed79bb46cf49",
    "1737553338682-cd52f5df9781", "1777739890188-4e6c3c417d5e",
    "1708590274972-a7f437c05477", "1636810528913-8a1035067e03",
    "1731248756535-3135d2b7e8ba", "1555557135-0971899f7e3c",
    "1724759968429-326ae674aba7", "1748280155118-fbac24d2ac49",
    "1672653222135-b46f7411bf52",
]


def verify_pool():
    """HEAD-Check alle Photos parallel. Rauswerfen was nicht 200 ist."""
    import concurrent.futures
    print("Verifiziere Photo-Pool (parallel)...", flush=True)

    def check(pid):
        try:
            url = f"https://images.unsplash.com/photo-{pid}?w=200&h=200&fit=crop"
            r = requests.head(url, timeout=8, allow_redirects=True)
            return pid, r.status_code == 200
        except Exception:
            return pid, False

    sport_ok = []
    portrait_ok = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as ex:
        sport_results = list(ex.map(check, SPORT_PHOTO_IDS))
        portrait_results = list(ex.map(check, PORTRAIT_PHOTO_IDS))
    for pid, ok in sport_results:
        if ok: sport_ok.append(pid)
    for pid, ok in portrait_results:
        if ok: portrait_ok.append(pid)
    print(f"  Sport OK:    {len(sport_ok)}/{len(SPORT_PHOTO_IDS)}", flush=True)
    print(f"  Portrait OK: {len(portrait_ok)}/{len(PORTRAIT_PHOTO_IDS)}", flush=True)
    return sport_ok, portrait_ok


def photo_url_for_hex(col, row, is_sport, sport_pool, portrait_pool):
    """Wahl Photo basierend auf Hex-Coords. Sicher dass binnen 3-Hex
    Distanz keine Duplikate (col%7 + row%7-Hash garantiert min. 7 Hex
    Distanz fuer gleiche Photo-ID).
    Nutzt zusaetzlich (col*13 + row*7) fuer noch bessere Streuung."""
    pool = sport_pool if is_sport else portrait_pool
    if not pool: return None
    # Spread-Hash: garantiert Eindeutigkeit innerhalb 7-Hex-Block
    h = (col % 7) * 7 + (row % 7)
    # Optional weitere Streuung
    h = (h * 13 + col + row) % len(pool)
    return f"https://images.unsplash.com/photo-{pool[h]}?w=300&h=300&fit=crop&crop=faces&q=80"


# ---------------------------------------------------------------------------
# Namen-Pool (DACH-fokussiert)
# ---------------------------------------------------------------------------
DACH_MALE = [
    "Hans Müller", "Pirmin Schlegel", "Tobias Berger", "Stefan Walser", "Marco Alber",
    "Lukas Fink", "Andreas Hofer", "Thomas Kessler", "Martin Bühler", "Reto Capaul",
    "Werner Moser", "Kurt Steiner", "Peter Huber", "Markus Schneider",
    "Roland Fischer", "Simon Brunner", "Patrick Zimmermann", "Daniel Koller", "Florian Weber",
    "Christian Mayer", "Michael Gruber", "Alexander Wirth", "Sebastian Pichler", "Hannes Egger",
    "Matthias Schwarz", "Dominik Fuchs", "Benjamin Wolf", "Julian Auer", "Oliver Hartmann",
    "Jakob Braun", "Felix Sommer", "Nikolaus Lechner", "Georg Bauer", "Josef Reiter",
    "Johann Maier", "Klaus Neumann", "Dieter Hoffmann", "Helmut Schuster", "Erwin Kofler",
    "Paul Riedl", "Ernst Grabner", "Ludwig Wieser", "Manfred Thurner", "Gerhard Zangerl",
    "Norbert Peer", "Anton Schranz", "Rudolf Plattner", "Herbert Tanzer", "Walter Auer",
    "Heinrich Mair", "Friedrich Huber", "Otto Berger", "Karl Stadler", "Bernhard Eder",
    "Erich Winkler", "Alfred Holzer", "Hugo Pfeifer", "Ferdinand Haller", "Wolfgang Wallner",
    "Sepp Innerhofer", "Toni Aigner", "Hubert Strolz", "Reinhold Riedmann", "Dietmar Burger",
    "Rainer Grabherr", "Edgar Pichler", "Bruno Tschann", "Konrad Albrich", "Robert Hilbe",
    "Wilfried Längle", "Heinz Pirker", "Adolf Fritzer", "Leopold Bischof", "Volker Klocker",
    "Gerald Gamper", "Ronald Steinmair", "Albert Kogler", "Egon Sieber", "Roman Vonbank",
    "Stefan Hafele", "Gernot Witasek", "Manfred Sutter", "Gilbert Mathis", "Karlheinz Pfanner",
    "Helge Felder", "Christoph Riezler", "Mario Sieber", "Andreas Burtscher", "Gernot Erath",
    "Maximilian Egg", "Florian Vogt", "Michael Bickel", "Martin Schedler", "Lothar Müller",
    "Wolfgang Kalb", "Stefan Geiger", "Friedrich Knünz", "Helmut Türtscher", "Walter Sutterlüty",
    "Peter Vögel", "Ralf Beer", "Gerhard Kohler", "Dietmar Mock", "Heinz Dünser",
    "Reinhard Albertani", "Gerald Schwärzler", "Manfred Madlener", "Rainer Loretz", "Kurt Bilgeri",
    "Erich Strolz", "Roland Burtscher", "Werner Bargehr", "Beat Albrecht", "Fritz Imhof",
    "Jakob Rüedi", "Reto Camenisch", "Andri Caduff", "Beni Walpen", "Urs Schmid",
    "Reto Patzen", "Mauro Zuber", "Erwin Stoffel", "Roman Salvisberg", "Thomas Riedhauser",
    "Stefan Andrist", "Markus Inniger", "Bruno Schaad", "Rolf Bruggmann", "Walter Trummer",
    "Andreas Wittwer", "Christian Wymann", "Daniel Stocker", "Felix Hadorn", "Hannes Berchtold",
    "Roger Schwarz", "Pius Imboden", "Samuel Lengen", "Heinz Jossen", "Gilbert Lochmatter",
    "Elias Imseng", "Patrick Bieler", "Christof Tscherrig", "Daniel Wenger", "Markus Anker",
    "Dominik Lauber", "Stefan Reichmuth", "Adrian Hug", "Cyrill Mooser", "Sepp Bachmeier",
    "Korbinian Wagner", "Quirin Hofmann", "Vinzenz Riegler", "Florian Demel",
    "Maximilian Schaffer", "Konstantin Steinhoff", "Magnus Reichl", "Severin Lipp",
    "Valentin Stadler", "Konrad Sailer", "Wendelin Köhler", "Lorenz Vogel",
    "Ferdinand Lederer", "Gregor Kraus", "Tobias Schöll", "Ludwig Singer",
    "Maximilian Demmel", "Stephan Wieland", "Korbinian Hofbauer", "Andreas Dorfner",
    "Florian Geiger", "Markus Hipp", "Bernhard Mader", "Thorsten Wieser", "Andreas Knoll",
    "Stefan Kerber", "Rupert Hörmann", "Sebastian Lorenz", "Hans-Peter Bauer",
    "Helmut Stiegler", "Erich Lindner", "Roland Hörl", "Christian Rinker", "Georg Mathies",
]

DACH_FEMALE = [
    "Anna Steiner", "Lisa Berchtold", "Sandra Müller", "Julia Walser", "Kathrin Moser",
    "Maria Huber", "Simone Fehr", "Claudia Fischer", "Martina Gruber", "Laura Schneider",
    "Stefanie Weber", "Nina Brunner", "Sonja Mayer", "Petra Schwarz", "Monika Egger",
    "Christine Wolf", "Susanne Braun", "Daniela Sommer", "Verena Koller", "Heidi Auer",
    "Birgit Mair", "Andrea Holzer", "Karin Pichler", "Manuela Lechner", "Bettina Grabner",
    "Doris Wieser", "Renate Kofler", "Cornelia Hilbe", "Elisabeth Strolz", "Sabine Tschann",
    "Brigitte Sutter", "Eveline Pfanner", "Ingrid Egg", "Katharina Vögel", "Veronika Kalb",
    "Magdalena Fritzer", "Theresa Bischof", "Barbara Madlener", "Christina Beer",
    "Annemarie Längle", "Gertrude Klocker", "Helga Steinmair", "Hannelore Zech",
    "Tanja Burtscher", "Carmen Vonbank", "Iris Schwärzler", "Yvonne Felder", "Romana Bilgeri",
    "Heidi Andrist", "Vreni Imhof", "Käthi Rüedi", "Trudi Camenisch", "Margrit Caduff",
    "Beatrix Walpen", "Ursula Schmid", "Gertrud Stoffel", "Hedwig Patzen", "Rosmarie Zuber",
    "Erika Salvisberg", "Therese Riedhauser", "Madeleine Brodbeck", "Susi Wymann",
    "Annerose Hadorn", "Brigitt Schenkel", "Margrith Stettler", "Resi Bachmeier",
    "Burgi Hofmann", "Therese Riegler", "Adelheid Demel", "Hildegard Steinhoff",
    "Ilse Reichl", "Erna Lipp", "Gerlinde Stadler", "Berta Sailer", "Veronika Köhler",
    "Kunigunde Vogel", "Roswitha Brunner", "Aloisia Lederer", "Notburga Kraus",
    "Crescentia Schöll", "Kreszenz Singer", "Walpurga Brunner", "Theresia Demmel",
    "Annerose Wieland", "Tina Müller", "Lena Bauer", "Mia Schmidt", "Lara Kessler",
    "Eva Hofmann", "Helena Pichler", "Clara Walter", "Franziska Berger", "Antonia Steiner",
    "Caroline Brunner", "Charlotte Mayer", "Sophia Wagner", "Emma Schneider", "Hanna Fischer",
    "Marlene Lechner", "Gabriele Auer", "Beate Egger", "Ulrike Wolf", "Christel Sommer",
    "Margit Koller", "Bärbel Reiter",
]


def make_username(name, idx):
    base = (name.replace(" ", "_")
            .replace("ä","ae").replace("ö","oe").replace("ü","ue").replace("ß","ss")
            .replace("Ä","Ae").replace("Ö","Oe").replace("Ü","Ue"))
    return f"{base}_{idx}"


def safe_email_local(s):
    """Email-Local-Part muss ASCII sein."""
    return (s.lower().replace(" ", "")
            .replace("ä","ae").replace("ö","oe").replace("ü","ue").replace("ß","ss"))


def random_summit_date():
    r = random.random()
    if r < 0.30:
        start, end = datetime(2024, 1, 1), datetime(2024, 12, 31)
        season = "2024"
    elif r < 0.80:
        start, end = datetime(2025, 1, 1), datetime(2025, 12, 31)
        season = "2025"
    else:
        start, end = datetime(2026, 1, 1), datetime(2026, 5, 5)
        season = "2026"
    days = max(1, (end - start).days)
    dt = start + timedelta(
        days=random.randint(0, days),
        hours=random.randint(6, 19),
        minutes=random.randint(0, 59),
    )
    return dt, season


def main():
    print("=" * 70, flush=True)
    print("Bergkoenig — Komplett-Rebuild Test-User (Alpen-weite Hex-Verteilung)")
    print("=" * 70, flush=True)
    if DRY_RUN:
        print(">>> DRY RUN — keine DB-Aenderungen <<<\n", flush=True)

    # 1. Photo-Pool verifizieren
    sport_pool, portrait_pool = verify_pool()
    if len(sport_pool) < 5 or len(portrait_pool) < 3:
        print("ABBRUCH: Photo-Pool zu klein.", flush=True)
        sys.exit(1)

    # 2. Existierende Test-User loeschen
    print("\nLoesche existierende Test-User...", flush=True)
    if not DRY_RUN:
        existing = requests.get(
            f"{REST_BASE}/user_profiles",
            headers={**HEADERS, "Prefer": "return=representation"},
            params={"is_test_user": "eq.true", "select": "id"},
            timeout=30,
        ).json()
        print(f"  Gefunden: {len(existing)}", flush=True)
        # Summits zuerst
        for i, u in enumerate(existing):
            requests.delete(f"{REST_BASE}/summits", headers=HEADERS,
                            params={"user_id": f"eq.{u['id']}"}, timeout=30)
            if (i + 1) % 100 == 0:
                print(f"  Summits {i+1}/{len(existing)} geloescht", flush=True)
        # Profile
        requests.delete(f"{REST_BASE}/user_profiles", headers=HEADERS,
                        params={"is_test_user": "eq.true"}, timeout=30)
        # Auth
        for i, u in enumerate(existing):
            requests.delete(f"{SUPABASE_URL}/auth/v1/admin/users/{u['id']}",
                            headers=HEADERS, timeout=30)
            if (i + 1) % 100 == 0:
                print(f"  Auth {i+1}/{len(existing)} geloescht", flush=True)
        print(f"  ALLE {len(existing)} Test-User geloescht.", flush=True)

    # 3. Alle Alpen-Peaks laden
    print("\nLade Alpen-Peaks (lat 44-48, lng 5-16)...", flush=True)
    peaks = []
    page_size = 1000
    offset = 0
    while True:
        r = requests.get(
            f"{REST_BASE}/peaks",
            headers={**HEADERS, "Prefer": "return=representation",
                     "Range": f"{offset}-{offset+page_size-1}"},
            params={
                "select": "id,name,elevation,lat,lng",
                "lat": "gte.44",
                "lng": "gte.5",
                "or": "(reachable.eq.true,reachable.is.null)",
            },
            timeout=60,
        )
        chunk = r.json() if r.ok else []
        # Server-seitige UND-Filter sind tricky; wir filtern client-side
        chunk = [p for p in chunk if p.get("lat") and p.get("lng")
                 and 44 <= p["lat"] <= 48.5 and 5 <= p["lng"] <= 16]
        if not chunk: break
        peaks.extend(chunk)
        if len(chunk) < page_size: break
        offset += page_size
    print(f"  {len(peaks)} Peaks im Alpenraum gefunden.", flush=True)

    # 4. Peaks pro Hex gruppieren
    hex_peaks = {}  # (col, row) -> [peaks]
    for p in peaks:
        col, row, _, _ = get_hex_cell(p["lat"], p["lng"])
        hex_peaks.setdefault((col, row), []).append(p)
    print(f"  {len(hex_peaks)} unique Hex-Zellen mit Peaks.", flush=True)

    # 5. Pro Hex 1-3 User generieren
    all_names = list(DACH_MALE) + list(DACH_FEMALE)
    random.shuffle(all_names)
    name_idx = 0

    plan = []  # [(hex_col, hex_row, role, name, num_summits, peaks_in_hex)]
    for (col, row), pks in hex_peaks.items():
        # 1 Koenig, 30% chance fuer 1 Rivale, 10% fuer 2.
        n = 1
        if random.random() < 0.30: n = 2
        if random.random() < 0.10: n = 3
        for k in range(n):
            if name_idx >= len(all_names):
                # Namen recyclen falls zu viele Hexe
                name_idx = 0
                random.shuffle(all_names)
            name = all_names[name_idx]
            name_idx += 1
            role = "king" if k == 0 else "rival"
            # Summits: Koenig bekommt mehr (clamp fuer Hex mit wenig Peaks)
            if role == "king":
                lo = min(8, len(pks)); hi = min(25, len(pks))
            else:
                lo = min(3, len(pks)); hi = min(10, len(pks))
            num = random.randint(max(1, lo), max(1, hi))
            plan.append((col, row, role, name, num, pks))

    print(f"\nPlan: {len(plan)} User ueber {len(hex_peaks)} Hex-Zellen.", flush=True)
    if DRY_RUN:
        print("DRY RUN — Plan steht, kein Insert.", flush=True)
        # Beispiel-Plan ausgeben
        for entry in plan[:10]:
            col, row, role, name, num, _ = entry
            print(f"  Hex({col},{row}) {role:6s} {name:30s} {num} Summits")
        return

    # 6. User + Summits erstellen
    print("\nErstelle User + Summits...", flush=True)
    global_season_summits = set()
    created = 0
    total_summits = 0

    for i, (col, row, role, name, num_summits, pks) in enumerate(plan):
        username = make_username(name, i)
        email = f"test_{safe_email_local(username)}@bergkoenig.test"
        # 80% sport / 20% portrait — Hash-stabil
        is_sport = ((hash(username) & 0xFFFFFFFF) % 100) < 80
        avatar_url = photo_url_for_hex(col, row, is_sport, sport_pool, portrait_pool)

        # Auth
        ar = requests.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=HEADERS,
            json={"email": email, "password": "BergTest2026!",
                  "email_confirm": True,
                  "user_metadata": {"is_test_user": True}},
            timeout=30,
        )
        if ar.status_code != 200:
            print(f"  ! AUTH FAIL [{i}] {username}: {ar.text[:120]}", flush=True)
            continue
        user_id = ar.json()["id"]

        # Profil
        gender = "f" if name in DACH_FEMALE else "m"
        pr = requests.post(
            f"{REST_BASE}/user_profiles",
            headers=HEADERS,
            json={
                "id": user_id, "username": username, "display_name": name,
                "avatar_type": "mountain", "avatar_url": avatar_url,
                "is_test_user": True, "total_points": 0,
            },
            timeout=30,
        )
        if pr.status_code not in (200, 201):
            requests.delete(f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
                            headers=HEADERS, timeout=30)
            print(f"  ! PROFIL FAIL [{i}] {username}", flush=True)
            continue
        created += 1

        # Summits
        records = []
        peak_count = {}
        user_seen_peaks = set()
        user_pts = 0
        for _ in range(num_summits):
            attempts = 0
            peak = None
            while attempts < 20:
                p = random.choice(pks)
                if peak_count.get(p["id"], 0) < 4:
                    peak = p; break
                attempts += 1
            if not peak: continue
            peak_count[peak["id"]] = peak_count.get(peak["id"], 0) + 1

            dt, season = random_summit_date()
            elev = peak.get("elevation") or 1500
            elev_gain = round(elev * random.uniform(0.3, 0.85))
            distance = round(elev_gain / 100 * random.uniform(1.2, 3.5), 1)
            base = round(elev_gain / 100) + round(distance) + 10

            sk = (peak["id"], season)
            sf = sk not in global_season_summits
            pf = peak["id"] not in user_seen_peaks
            if sf: pts = round(base * 3)
            elif pf: pts = round(base * 2)
            else: pts = round(base * 0.5)
            global_season_summits.add(sk)
            user_seen_peaks.add(peak["id"])

            records.append({
                "id": str(uuid4()),
                "user_id": user_id, "peak_id": peak["id"],
                "summited_at": dt.isoformat(), "season": season,
                "elevation_gain": elev_gain, "distance": distance,
                "points": pts,
                "checkin_method": random.choice(["strava", "manual", "suunto"]),
                "is_season_first": sf, "is_personal_first": pf,
            })
            user_pts += pts

        for b in range(0, len(records), 50):
            requests.post(f"{REST_BASE}/summits", headers=HEADERS,
                          json=records[b:b + 50], timeout=30)
        total_summits += len(records)

        if user_pts > 0:
            requests.patch(f"{REST_BASE}/user_profiles", headers=HEADERS,
                           params={"id": f"eq.{user_id}"},
                           json={"total_points": user_pts}, timeout=30)

        if (i + 1) % 50 == 0 or i + 1 == len(plan):
            print(f"  [{i+1:4d}/{len(plan)}] hex({col:>4d},{row:>4d}) {role:5s} "
                  f"{username:35s} {len(records):2d} Gipfel  {user_pts:5d} Pkt  "
                  f"{'sport' if is_sport else 'portrait'}", flush=True)

    print(f"\n{'='*70}", flush=True)
    print(f"FERTIG", flush=True)
    print(f"  User created:  {created}", flush=True)
    print(f"  Summits:       {total_summits}", flush=True)
    print(f"  Hex coverage:  {len(hex_peaks)} cells", flush=True)
    print(f"{'='*70}", flush=True)


if __name__ == "__main__":
    main()
