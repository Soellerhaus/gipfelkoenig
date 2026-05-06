#!/usr/bin/env python3
"""
Bergkoenig Fake-User Generator (500 User mit Profilbildern)
============================================================

Erstellt 500 realistische Test-User mit:
- Profilbildern (DiceBear Avataaars-API, kostenlos, kein Auth)
- Realistischen Alpen-Namen (Oesterreich/Deutschland/Schweiz/Italien)
- Gipfel-Besteigungen verteilt ueber den gesamten Alpenraum
- Verschiedene Aktivitaetsstufen (Hardcore/Active/Regular/Casual/Newbie)

ZIEL: Karte beleben — viele Hex-Territorien mit verschiedenen Avataren.

Usage:
  export SUPABASE_SERVICE_KEY="eyJ..."
  python create-fake-users-500.py --create   # Erstelle 500 Test-User
  python create-fake-users-500.py --delete   # Loesche ALLE Test-User
  python create-fake-users-500.py --count    # Statistiken anzeigen
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
    print("FEHLER: pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Supabase Config
# ---------------------------------------------------------------------------
SUPABASE_URL = "https://wbrvkweezbeakfphssxp.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
REST_BASE = f"{SUPABASE_URL}/rest/v1"

AVATAR_TYPES = ["mountain", "eagle", "ski", "climber", "tree", "snow", "deer", "rock"]

# DiceBear Styles fuer Variety. Jeder User bekommt einen zufaelligen Style.
# Alle sind kostenlos, brauchen keinen API-Key, returnen SVG.
DICEBEAR_STYLES = [
    "avataaars",      # Cartoon-Gesichter (klassisch)
    "adventurer",     # Abenteurer-Stil
    "big-smile",      # Lachende Cartoon-Gesichter
    "micah",          # Stilisierte Portraits
    "personas",       # Vielfaeltige Charaktere
    "lorelei",        # Aquarell-Stil
    "notionists",     # Notion-Stil
    "open-peeps",     # Hand-gezeichnet
]

CHECKIN_METHODS = [
    ("strava", 0.55),
    ("manual", 0.20),
    ("suunto", 0.15),
    ("gpx_upload", 0.10),
]

# ---------------------------------------------------------------------------
# 500 User-Namen — aufgeteilt nach Sprachregion + Stil
# ---------------------------------------------------------------------------
# Oesterreich (Tirol, Salzburg, Vorarlberg, Steiermark) — 150 Namen
AT_MALE = [
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
    "Walter Auer", "Heinrich Mair", "Friedrich Huber", "Otto Berger", "Gustav Lehner",
    "Karl Stadler", "Bernhard Eder", "Erich Winkler", "Alfred Holzer", "Hugo Pfeifer",
    "Ferdinand Haller", "Wolfgang Wallner", "Sepp Innerhofer", "Toni Aigner", "Hubert Strolz",
    "Reinhold Riedmann", "Dietmar Burger", "Rainer Grabherr", "Edgar Pichler", "Bruno Tschann",
    "Konrad Albrich", "Robert Hilbe", "Wilfried Längle", "Heinz Pirker", "Adolf Fritzer",
    "Leopold Bischof", "Volker Klocker", "Gerald Gamper", "Ronald Steinmair", "Albert Kogler",
    "Egon Sieber", "Roman Vonbank", "Stefan Hafele", "Gernot Witasek", "Manfred Sutter",
    "Gilbert Mathis", "Karlheinz Pfanner", "Reto Hueber", "Helge Felder", "Hans-Peter Beer",
    "Roland Zech", "Christoph Riezler", "Mario Sieber", "Andreas Burtscher", "Gernot Erath",
    "Peter Halbeisen", "Maximilian Egg", "Florian Vogt", "Michael Bickel", "Martin Schedler",
    "Lothar Müller", "Wolfgang Kalb", "Stefan Geiger", "Friedrich Knünz", "Helmut Türtscher",
    "Walter Sutterlüty", "Peter Vögel", "Ralf Beer", "Gerhard Kohler", "Dietmar Mock",
    "Heinz Dünser", "Reinhard Albertani", "Gerald Schwärzler", "Manfred Madlener", "Rainer Loretz",
    "Kurt Bilgeri", "Erich Strolz", "Roland Burtscher", "Werner Bargehr", "Karl-Heinz Linhart",
]

AT_FEMALE = [
    "Anna Steiner", "Lisa Berchtold", "Sandra Müller", "Julia Walser", "Kathrin Moser",
    "Maria Huber", "Simone Fehr", "Elena Bianchi", "Claudia Fischer", "Martina Gruber",
    "Laura Schneider", "Stefanie Weber", "Nina Brunner", "Sonja Mayer", "Petra Schwarz",
    "Monika Egger", "Christine Wolf", "Susanne Braun", "Daniela Sommer", "Verena Koller",
    "Heidi Auer", "Birgit Mair", "Andrea Holzer", "Karin Pichler", "Manuela Lechner",
    "Bettina Grabner", "Doris Wieser", "Renate Kofler", "Cornelia Hilbe", "Elisabeth Strolz",
    "Sabine Tschann", "Roswitha Innerhofer", "Brigitte Sutter", "Eveline Pfanner", "Ingrid Egg",
    "Katharina Vögel", "Veronika Kalb", "Magdalena Fritzer", "Theresa Bischof", "Barbara Madlener",
    "Christina Beer", "Annemarie Längle", "Gertrude Klocker", "Helga Steinmair", "Hannelore Zech",
    "Tanja Burtscher", "Carmen Vonbank", "Iris Schwärzler", "Yvonne Felder", "Romana Bilgeri",
]

# Deutschland (Bayern, Allgäu) — 80 Namen
DE_MALE = [
    "Sepp Bachmeier", "Korbinian Wagner", "Quirin Hofmann", "Vinzenz Riegler", "Florian Demel",
    "Maximilian Schaffer", "Konstantin Steinhoff", "Magnus Reichl", "Severin Lipp", "Valentin Stadler",
    "Konrad Sailer", "Wendelin Köhler", "Lorenz Vogel", "Dominik Brunner", "Ferdinand Lederer",
    "Gregor Kraus", "Tobias Schöll", "Ludwig Singer", "Ulrich Brunner", "Maximilian Demmel",
    "Stephan Wieland", "Korbinian Hofbauer", "Andreas Dorfner", "Florian Geiger", "Markus Hipp",
    "Bernhard Mader", "Thorsten Wieser", "Andreas Knoll", "Stefan Kerber", "Rupert Hörmann",
    "Sebastian Lorenz", "Hans-Peter Bauer", "Helmut Stiegler", "Erich Lindner", "Roland Hörl",
    "Christian Rinker", "Georg Mathies", "Wilhelm Reinhardt", "Otto Schöllhammer", "Egon Wittmann",
    "Friedrich Vogel", "Klemens Schultes", "Anton Brunner", "Reinhard Walter", "Ferdinand Eberle",
    "Oskar Kreutzer", "Albrecht Hecht", "Eduard Rauch", "Adelbert Hölzle", "Harald Bachmann",
    "Markus Wittmann", "Roland Bachmair", "Tobias Kraft", "Jonas Hofmeister", "Rupert Leitner",
    "Hannes Schenk", "Johann Lechner", "Markus Holzer", "Karl-Heinz Bauer", "Manfred Kaufmann",
]

DE_FEMALE = [
    "Resi Bachmeier", "Burgi Hofmann", "Therese Riegler", "Adelheid Demel", "Maria Schaffer",
    "Hildegard Steinhoff", "Ilse Reichl", "Erna Lipp", "Gerlinde Stadler", "Berta Sailer",
    "Veronika Köhler", "Kunigunde Vogel", "Roswitha Brunner", "Aloisia Lederer", "Notburga Kraus",
    "Crescentia Schöll", "Kreszenz Singer", "Walpurga Brunner", "Theresia Demmel", "Annerose Wieland",
]

# Schweiz (Wallis, Berner Oberland, Graubünden) — 80 Namen
CH_MALE = [
    "Beat Albrecht", "Fritz Imhof", "Jakob Rüedi", "Reto Camenisch", "Andri Caduff",
    "Beni Walpen", "Urs Schmid", "Sämi Stoffel", "Reto Patzen", "Mauro Zuber",
    "Niccolò Pellegrini", "Dario Bezzola", "Florian Zwygart", "Erwin Stoffel", "Roman Salvisberg",
    "Thomas Riedhauser", "Stefan Andrist", "Markus Inniger", "Bruno Schaad", "Rolf Bruggmann",
    "Walter Trummer", "Andreas Wittwer", "Christian Wymann", "Daniel Stocker", "Felix Hadorn",
    "Hans-Ulrich Brodbeck", "Jürg Bitterli", "Kurt Ramseier", "Lukas Wyss", "Martin Schenkel",
    "Niklaus Kropf", "Patrick Stettler", "Peter Ammeter", "Reinhard Bigler", "Ruedi Wyler",
    "Sandro Petrini", "Thierry Wenger", "Werner Aufdermauer", "Yves Bourquin", "Zenon Rzehak",
    "Alessandro Bernasconi", "Davide Fontana", "Marco Solari", "Riccardo Camenzind", "Lorenzo Frisoni",
    "Hannes Berchtold", "Roger Schwarz", "Pius Imboden", "Samuel Lengen", "Heinz Jossen",
    "Gilbert Lochmatter", "Elias Imseng", "Patrick Bieler", "Christof Tscherrig", "Daniel Wenger",
    "Markus Anker", "Dominik Lauber", "Stefan Reichmuth", "Adrian Hug", "Cyrill Mooser",
]

CH_FEMALE = [
    "Heidi Andrist", "Vreni Imhof", "Käthi Rüedi", "Trudi Camenisch", "Margrit Caduff",
    "Beatrix Walpen", "Ursula Schmid", "Gertrud Stoffel", "Hedwig Patzen", "Rosmarie Zuber",
    "Gianna Pellegrini", "Stefania Bezzola", "Verena Zwygart", "Erika Salvisberg", "Therese Riedhauser",
    "Madeleine Brodbeck", "Susi Wymann", "Annerose Hadorn", "Brigitt Schenkel", "Margrith Stettler",
]

# Italien (Südtirol, Trentino) — 50 Namen
IT_MALE = [
    "Alessandro Pellegrini", "Marco Bianchi", "Luca Rossi", "Davide Conti", "Stefano Greco",
    "Gianluca Esposito", "Roberto Marchi", "Federico Bruno", "Claudio Russo", "Massimo Ferri",
    "Niccolò Romano", "Lorenzo Sartori", "Andrea Pellizzari", "Filippo Montanari", "Gabriele Galli",
    "Reinhold Messner", "Ludwig Pichler", "Sepp Steiner", "Hans Pichler", "Toni Stoll",
    "Florian Klotz", "Hannes Pichler", "Manfred Klotz", "Elias Vinzens", "Severin Lampacher",
    "Hubert Pichler", "Toni Innerhofer", "Sepp Niederwolfsgruber", "Karl Engl", "Matteo Costa",
    "Simone Marini", "Luca Trentini", "Lorenzo Vesti", "Pietro Decarli", "Davide Cattoi",
    "Andrea Pedrolli", "Marco Veneri", "Stefano Defrancesco", "Lorenzo Zenetti", "Gianni Festi",
]

IT_FEMALE = [
    "Maria Pellegrini", "Anna Bianchi", "Sofia Rossi", "Giulia Conti", "Francesca Greco",
    "Marta Esposito", "Elena Marchi", "Chiara Bruno", "Sara Russo", "Veronica Ferri",
    "Magdalena Pichler", "Theresia Klotz", "Hildegard Steiner", "Notburga Innerhofer", "Filomena Pichler",
]

# Frankreich (Savoyen, Hochsavoyen) — 30 Namen
FR_MALE = [
    "Pierre Dubois", "Antoine Roux", "Maxime Lefebvre", "Olivier Mercier", "Sébastien Bonnet",
    "Julien Mathieu", "Vincent Petit", "Christophe Robert", "Nicolas Faure", "Bertrand Lambert",
    "Yannick Roussel", "Frédéric Renaud", "Damien Vincent", "Stéphane Charpentier", "Romain Lacombe",
    "Émile Berthod", "Lucien Charvin", "Bernard Dunand", "Jean-Marc Tournier", "Patrick Peillex",
]

FR_FEMALE = [
    "Sophie Dubois", "Claire Roux", "Marion Lefebvre", "Camille Mercier", "Élise Bonnet",
    "Hélène Mathieu", "Anne Robert", "Isabelle Faure", "Catherine Berthod", "Nathalie Tournier",
]

# Fantasy / Trail-Handles — 110 Namen (verschiedene Stile)
FANTASY_USERS = [
    # Trail/Bergsport
    "Sugus", "Bergsteiger", "PRS25", "AlpinFuchs", "GipfelJäger",
    "TrailWolf", "BergNomad", "Höhenmeter", "Schneeleopard", "Steinadler",
    "Gämse007", "MountainGoat", "KletterMax", "WandererX", "Yeti2025",
    "TrailQueen", "BergFee", "AlpenRose", "GipfelHexe", "Edelweiss",
    "AlpenJäger", "BergKönigin", "GletscherFeu", "FelsKraxler", "BergHerz",
    "SchneeKönig", "Steinblock", "Wolkenläufer", "BergPirat", "GletscherWolf",
    "Gipfelstürmer", "AlpenSchatten", "BergNebel", "FelsFischer", "WildPfad",
    "Mondscheiner", "SternBlick", "TalerWind", "Höhenflug", "Gratspaziergang",
    "Almhirte", "BergNymphe", "Klettermaus", "FelsenKrabbe", "Adlerblick",
    "Sonnenwende", "BergFalke", "Wolkenbruch", "EisBlume", "FelsTaucher",
    "GletscherKuss", "BergNomad2", "AlpenLicht", "Gipfelglück", "Wolkenmacher",
    "Murmel", "Gemsbock", "Hochalp", "Steinbock86", "Bergblick",
    "Wanderfalke", "Schmetterlich", "BergGeist", "TalNebel", "Wegweiser",
    "Schneerose", "BergFeuer", "Lebensraum", "AlpenKristall", "Felsbiber",
    "Sonnenfänger", "WindStürmer", "BergSeele", "EngeKurve", "ZackenRiff",
    # International English handles
    "TrailDog", "AlpineSeeker", "PeakRunner", "MountainMike", "CragRat",
    "ColdFeet", "LongHaul", "RidgeRider", "SwitchbackSam", "EaglePoint",
    "VertGirl", "ScrambleQueen", "TraverseT", "SnowDoctor", "RockyRoad",
    "AlpineKing", "SummitNinja", "ValleyView", "CragQueen", "PeakHunter",
    "BackcountryBob", "TrailAngel", "ScreeRider", "BlazingTrail", "ColdMountain",
    # Outdoor brand-feel
    "Karwendel", "Ortler", "Stubai", "Ötzi2025", "Triglav",
    "Großglockner", "Mont-Blanc-Fan", "Eiger", "Watzmann", "Dolomite",
    "Karwendler", "Tauern", "Adamello", "Bergell", "Silvretta",
]


def build_all_users():
    """Baue Liste aller 500 User mit (name, gender, name_type)."""
    users = []
    for n in AT_MALE: users.append((n, "m", "realistic"))
    for n in AT_FEMALE: users.append((n, "f", "realistic"))
    for n in DE_MALE: users.append((n, "m", "realistic"))
    for n in DE_FEMALE: users.append((n, "f", "realistic"))
    for n in CH_MALE: users.append((n, "m", "realistic"))
    for n in CH_FEMALE: users.append((n, "f", "realistic"))
    for n in IT_MALE: users.append((n, "m", "realistic"))
    for n in IT_FEMALE: users.append((n, "f", "realistic"))
    for n in FR_MALE: users.append((n, "m", "realistic"))
    for n in FR_FEMALE: users.append((n, "f", "realistic"))
    # Fantasy: zufaellig m/f zuweisen
    for n in FANTASY_USERS:
        users.append((n, random.choice(["m", "f"]), "fantasy"))
    return users


# ---------------------------------------------------------------------------
# Regionen — viel breiter verteilt fuer mehr Hex-Coverage
# ---------------------------------------------------------------------------
REGIONS = {
    "kleinwalsertal":   {"count": 30, "lat_min": 47.30, "lat_max": 47.40, "lng_min": 10.05, "lng_max": 10.25},
    "oberallgaeu":      {"count": 50, "lat_min": 47.30, "lat_max": 47.55, "lng_min": 10.20, "lng_max": 10.55},
    "lechtal":          {"count": 30, "lat_min": 47.10, "lat_max": 47.40, "lng_min": 10.30, "lng_max": 10.80},
    "tirol_nord":       {"count": 40, "lat_min": 47.20, "lat_max": 47.45, "lng_min": 10.80, "lng_max": 11.60},
    "stubai_zillertal": {"count": 35, "lat_min": 46.90, "lat_max": 47.25, "lng_min": 11.20, "lng_max": 12.20},
    "bregenzerwald":    {"count": 25, "lat_min": 47.30, "lat_max": 47.55, "lng_min": 9.80,  "lng_max": 10.10},
    "silvretta":        {"count": 25, "lat_min": 46.80, "lat_max": 47.10, "lng_min": 10.00, "lng_max": 10.30},
    "raetikon":         {"count": 20, "lat_min": 47.00, "lat_max": 47.20, "lng_min": 9.70,  "lng_max": 10.00},
    "oberengadin":      {"count": 25, "lat_min": 46.40, "lat_max": 46.65, "lng_min": 9.70,  "lng_max": 10.20},
    "berner_oberland":  {"count": 35, "lat_min": 46.45, "lat_max": 46.75, "lng_min": 7.70,  "lng_max": 8.30},
    "wallis":           {"count": 30, "lat_min": 45.95, "lat_max": 46.40, "lng_min": 7.50,  "lng_max": 8.20},
    "salzburg":         {"count": 30, "lat_min": 47.00, "lat_max": 47.45, "lng_min": 12.50, "lng_max": 13.30},
    "hohe_tauern":      {"count": 25, "lat_min": 47.00, "lat_max": 47.20, "lng_min": 12.50, "lng_max": 13.20},
    "dolomiten":        {"count": 35, "lat_min": 46.30, "lat_max": 46.80, "lng_min": 11.50, "lng_max": 12.30},
    "ortler":           {"count": 20, "lat_min": 46.40, "lat_max": 46.65, "lng_min": 10.40, "lng_max": 10.70},
    "trentino":         {"count": 20, "lat_min": 45.80, "lat_max": 46.40, "lng_min": 10.50, "lng_max": 11.50},
    "savoyen":          {"count": 25, "lat_min": 45.40, "lat_max": 46.20, "lng_min": 6.30,  "lng_max": 7.20},
    "multi_region":     {"count": 0},  # automatisch berechnet
}

# Multi-Region Rest auffuellen
_total = sum(r["count"] for r in REGIONS.values())
REGIONS["multi_region"]["count"] = max(0, 500 - _total)


ACTIVITY_POOL = (
    [("hardcore", 25, 40)] * 25
    + [("active", 12, 24)] * 75
    + [("regular", 5, 11)] * 175
    + [("casual", 2, 4)] * 150
    + [("newbie", 1, 1)] * 75
)
# Hinweis: Pool hat 500 Slots; ueberschuessige User bekommen "regular" (Fallback unten).


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def get_headers(minimal=True):
    h = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal" if minimal else "return=representation",
    }
    return h


def supabase_get(table, query_string=""):
    url = f"{REST_BASE}/{table}"
    if query_string: url = f"{url}?{query_string}"
    resp = requests.get(url, headers=get_headers(minimal=False), timeout=30)
    resp.raise_for_status()
    return resp.json()


def supabase_post(table, data):
    url = f"{REST_BASE}/{table}"
    resp = requests.post(url, headers=get_headers(minimal=True), json=data, timeout=30)
    if resp.status_code not in (200, 201):
        print(f"  ! POST {table} {resp.status_code}: {resp.text[:200]}")
    return resp


def supabase_patch(table, match_params, data):
    url = f"{REST_BASE}/{table}"
    resp = requests.patch(url, headers=get_headers(minimal=True), params=match_params, json=data, timeout=30)
    return resp


def supabase_delete(table, params):
    url = f"{REST_BASE}/{table}"
    resp = requests.delete(url, headers=get_headers(minimal=True), params=params, timeout=30)
    return resp


# ---------------------------------------------------------------------------
# Avatar-URL generieren (DiceBear, kostenlos, kein Auth)
# ---------------------------------------------------------------------------
def make_avatar_url(seed):
    """DiceBear SVG-Avatar mit zufaelligem Style basierend auf Seed."""
    style = random.choice(DICEBEAR_STYLES)
    # Seed URL-encoden
    safe_seed = requests.utils.quote(seed)
    # Optional: Hintergrund-Farben aus Bergkönig-Palette
    bg = random.choice(["c9a84c", "1a1814", "2d2a26", "5a4a2e", "8b6f3a"])
    return f"https://api.dicebear.com/7.x/{style}/svg?seed={safe_seed}&backgroundColor={bg}"


# ---------------------------------------------------------------------------
# Peak-Cache pro Region
# ---------------------------------------------------------------------------
def fetch_peaks_for_region(region_key):
    r = REGIONS[region_key]
    if "lat_min" not in r:
        return []
    qs = (
        f"select=id,name,elevation,lat,lng"
        f"&lat=gte.{r['lat_min']}&lat=lte.{r['lat_max']}"
        f"&lng=gte.{r['lng_min']}&lng=lte.{r['lng_max']}"
        f"&limit=500"
    )
    url = f"{REST_BASE}/peaks?{qs}"
    resp = requests.get(url, headers=get_headers(minimal=False), timeout=30)
    if resp.status_code != 200:
        return []
    return resp.json()


def assign_users_to_regions(all_users):
    shuffled = list(all_users)
    random.shuffle(shuffled)
    assignments = []
    idx = 0
    for region_key, conf in REGIONS.items():
        if region_key == "multi_region":
            continue
        for _ in range(conf["count"]):
            if idx >= len(shuffled): break
            n, g, t = shuffled[idx]
            assignments.append((n, g, t, region_key))
            idx += 1
    # Multi-Region: Rest
    while idx < len(shuffled):
        n, g, t = shuffled[idx]
        assignments.append((n, g, t, "multi_region"))
        idx += 1
    return assignments


def pick_checkin_method():
    r = random.random()
    cum = 0.0
    for m, w in CHECKIN_METHODS:
        cum += w
        if r < cum: return m
    return "manual"


def random_datetime_in_season(season):
    year = int(season)
    if year == 2024:
        start, end = datetime(2024, 1, 1), datetime(2024, 12, 31)
    elif year == 2025:
        start, end = datetime(2025, 1, 1), datetime(2025, 12, 31)
    else:
        start, end = datetime(2026, 1, 1), datetime(2026, 5, 5)
    days = max(1, (end - start).days)
    return start + timedelta(
        days=random.randint(0, days),
        hours=random.randint(6, 19),
        minutes=random.randint(0, 59),
    )


def make_username(name, name_type):
    if name_type == "fantasy":
        return name
    return name.replace(" ", "_").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")


# ---------------------------------------------------------------------------
# CREATE
# ---------------------------------------------------------------------------
def create_test_data():
    all_users = build_all_users()
    target_count = len(all_users)
    print(f"Ziel: {target_count} Test-User")

    if target_count != 500:
        print(f"WARNUNG: User-Liste hat {target_count} Eintraege, nicht exakt 500.")

    existing = supabase_get("user_profiles", "is_test_user=eq.true&select=id,username")
    existing_usernames = {u["username"] for u in existing}
    if existing_usernames:
        print(f"Bereits {len(existing_usernames)} Test-User vorhanden — diese werden uebersprungen.\n")

    print("Lade Gipfel pro Region...")
    peaks_cache = {}
    for region_key in REGIONS:
        if region_key == "multi_region": continue
        peaks = fetch_peaks_for_region(region_key)
        peaks_cache[region_key] = peaks
        print(f"  {region_key:18s}: {len(peaks)} Gipfel")

    empty = [k for k, v in peaks_cache.items() if not v]
    if empty:
        print(f"\n  WARNUNG: Keine Gipfel in {', '.join(empty)} — User dort werden ohne Summits angelegt\n")

    assignments = assign_users_to_regions(all_users)
    if len(ACTIVITY_POOL) >= len(assignments):
        activity_pool = list(ACTIVITY_POOL[:len(assignments)])
    else:
        activity_pool = list(ACTIVITY_POOL) + [("regular", 5, 11)] * (len(assignments) - len(ACTIVITY_POOL))
    random.shuffle(activity_pool)

    global_season_summits = set()
    created_users = 0
    total_summits = 0
    all_user_points = {}

    print(f"\nErstelle {len(assignments)} Test-User mit Profilbildern...\n")

    for i, (name, gender, name_type, region_key) in enumerate(assignments):
        username = make_username(name, name_type)
        display_name = name
        activity_label, mn, mx = activity_pool[i]
        num_summits = random.randint(mn, mx)

        if username in existing_usernames:
            continue

        email = f"test_{username.lower().replace(' ','')}@bergkoenig.test"
        avatar_url = make_avatar_url(name)

        # Auth-User anlegen
        auth_resp = requests.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=get_headers(),
            json={
                "email": email,
                "password": "BergTest2026!",
                "email_confirm": True,
                "user_metadata": {"is_test_user": True}
            },
            timeout=30,
        )
        if auth_resp.status_code != 200:
            print(f"  [{i+1:3d}/{len(assignments)}] AUTH FAIL {username}: {auth_resp.text[:80]}")
            continue

        user_id = auth_resp.json()["id"]

        # Profil
        profile = {
            "id": user_id,
            "username": username,
            "display_name": display_name,
            "avatar_type": random.choice(AVATAR_TYPES),
            "avatar_url": avatar_url,
            "is_test_user": True,
            "total_points": 0,
        }
        resp = supabase_post("user_profiles", profile)
        if resp.status_code not in (200, 201):
            requests.delete(f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}", headers=get_headers(), timeout=30)
            print(f"  [{i+1:3d}] PROFIL FAIL {username}")
            continue

        created_users += 1

        # Peaks bestimmen
        if region_key == "multi_region":
            non_empty = [k for k, v in peaks_cache.items() if v]
            if len(non_empty) < 2:
                user_peaks = []
            else:
                chosen = random.sample(non_empty, min(random.randint(2, 4), len(non_empty)))
                user_peaks = []
                for rk in chosen: user_peaks.extend(peaks_cache[rk])
        else:
            user_peaks = peaks_cache.get(region_key, [])

        if not user_peaks:
            print(f"  [{i+1:3d}/{len(assignments)}] {username:30s} — keine Peaks in {region_key}")
            continue

        # Summits
        user_summit_records = []
        user_peak_count = {}
        user_summited_peaks = set()
        user_total_points = 0

        for _ in range(num_summits):
            attempts = 0
            peak = None
            while attempts < 20:
                p = random.choice(user_peaks)
                if user_peak_count.get(p["id"], 0) < 4:
                    peak = p
                    break
                attempts += 1
            if not peak: continue

            user_peak_count[peak["id"]] = user_peak_count.get(peak["id"], 0) + 1

            # Saison: 30% 2024, 50% 2025, 20% 2026
            r = random.random()
            season = "2024" if r < 0.30 else ("2025" if r < 0.80 else "2026")
            summited_at = random_datetime_in_season(season)

            elevation = peak.get("elevation") or 1500
            elevation_gain = round(elevation * random.uniform(0.3, 0.85))
            distance = round(elevation_gain / 100 * random.uniform(1.2, 3.5), 1)
            base = round(elevation_gain / 100) + round(distance) + 10

            sk = (peak["id"], season)
            is_season_first = sk not in global_season_summits
            is_personal_first = peak["id"] not in user_summited_peaks
            if is_season_first: pts = round(base * 3)
            elif is_personal_first: pts = round(base * 2)
            else: pts = round(base * 0.5)

            global_season_summits.add(sk)
            user_summited_peaks.add(peak["id"])

            user_summit_records.append({
                "id": str(uuid4()),
                "user_id": user_id,
                "peak_id": peak["id"],
                "summited_at": summited_at.isoformat(),
                "season": season,
                "elevation_gain": elevation_gain,
                "distance": distance,
                "points": pts,
                "checkin_method": pick_checkin_method(),
                "is_season_first": is_season_first,
                "is_personal_first": is_personal_first,
            })
            user_total_points += pts

        for b in range(0, len(user_summit_records), 50):
            supabase_post("summits", user_summit_records[b:b + 50])

        total_summits += len(user_summit_records)
        all_user_points[user_id] = user_total_points

        if (i + 1) % 25 == 0 or i + 1 == len(assignments):
            print(
                f"  [{i+1:3d}/{len(assignments)}] {username:30s} | {region_key:18s} | "
                f"{activity_label:8s} | {len(user_summit_records):3d} Gipfel | {user_total_points:6d} Pkt"
            )

    print("\nAktualisiere total_points fuer alle neuen Test-User...")
    for uid, pts in all_user_points.items():
        supabase_patch("user_profiles", {"id": f"eq.{uid}"}, {"total_points": pts})

    print(f"\n{'='*70}")
    print(f"FERTIG")
    print(f"  Neue User erstellt: {created_users}")
    print(f"  Summits insgesamt:  {total_summits}")
    print(f"{'='*70}")


def delete_test_data():
    test_users = supabase_get("user_profiles", "is_test_user=eq.true&select=id,username")
    if not test_users:
        print("Keine Test-User vorhanden.")
        return
    print(f"Loesche {len(test_users)} Test-User + ihre Summits...")
    for i, u in enumerate(test_users):
        uid = u["id"]
        supabase_delete("summits", {"user_id": f"eq.{uid}"})
        if (i + 1) % 50 == 0:
            print(f"  Summits {i+1}/{len(test_users)} geloescht")
    supabase_delete("user_profiles", {"is_test_user": "eq.true"})
    for i, u in enumerate(test_users):
        requests.delete(f"{SUPABASE_URL}/auth/v1/admin/users/{u['id']}", headers=get_headers(), timeout=30)
        if (i + 1) % 50 == 0:
            print(f"  Auth-User {i+1}/{len(test_users)} geloescht")
    print(f"\nFertig: {len(test_users)} Test-User komplett entfernt.")


def count_test_data():
    test_users = supabase_get("user_profiles",
        "is_test_user=eq.true&select=id,username,total_points,avatar_url&order=total_points.desc")
    if not test_users:
        print("Keine Test-User.")
        return
    with_avatar = sum(1 for u in test_users if u.get("avatar_url"))
    print(f"Test-User gesamt: {len(test_users)} (mit Avatar-URL: {with_avatar})")
    print(f"\nTop 20:")
    for u in test_users[:20]:
        print(f"  {u['username']:30s} {u.get('total_points', 0):>7d} Pkt")


def main():
    parser = argparse.ArgumentParser()
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--create", action="store_true")
    g.add_argument("--delete", action="store_true")
    g.add_argument("--count", action="store_true")
    args = parser.parse_args()

    if not SUPABASE_KEY:
        print("FEHLER: export SUPABASE_SERVICE_KEY='eyJ...' setzen!")
        sys.exit(1)

    if args.create: create_test_data()
    elif args.delete: delete_test_data()
    elif args.count: count_test_data()


if __name__ == "__main__":
    main()
