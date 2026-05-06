#!/usr/bin/env python3
"""
Bergkoenig — Update Test-User auf SPORTLICHE/OUTDOOR Profilbilder
==================================================================

Nutzt curated Unsplash-Photo-URLs (Wanderer, Bergsteiger, Trail-Runner,
Kletterer). Direkte Bild-Links, kein API-Key noetig.

Nach dem Update wird auch geprueft welche URLs tatsaechlich 200 zurueckgeben
und kaputte URLs durch funktionierende ersetzt.

Usage:
  export SUPABASE_SERVICE_KEY="eyJ..."
  python scripts/update-test-avatars-sport.py
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

# Curated Unsplash Photo IDs aus den Themen Hiking/Climbing/Trail-Running.
# Format: 'photo-{ID}' — Direkt-URL via images.unsplash.com.
# Diese werden alle vor dem Update geprueft (HEAD 200) und nur funktionierende
# in den Pool aufgenommen.
SPORT_PHOTOS_POOL = [
    # Hiking / Wanderung (geschlechtsneutral)
    "1551632811-561732d1e306",  # Hiker Sonnenuntergang
    "1502901502293-0bf56da7a0f6",  # Wanderer Bergpfad
    "1455156218388-5e61b526818b",  # Trail Wanderer
    "1464822759023-fed622ff2c3b",  # Mountain Hiker
    "1486312338219-ce68d2c6f44d",  # Person Wanderwege
    "1499856871958-5b9627545d1a",  # Hiker Berge
    "1551524559-8af4e6624178",  # Climber
    "1517511620798-cec17d428bc0",  # Mountain Person
    "1530126483408-aa533e55bdb2",  # Hiker
    "1533692328991-08159ff19fca",  # Climber Frau
    "1540206395-68808572332f",  # Trail Runner
    "1551632436-cbf8dd35adfa",  # Wanderer
    "1559762717-99c81ac85459",  # Hiker Alpen
    "1517649763962-0c623066013b",  # Mann Berg
    "1485628390555-1a7bd3c787a7",  # Snow hiker
    "1488646953014-85cb44e25828",  # Outdoor portrait
    "1521336575822-6da63fb45455",  # Climber
    "1518644961665-ed172691aaa1",  # Trail
    "1471341971476-ae15ff5dd4ea",  # Hiker landscape
    "1542401886-65d6c61db217",  # Skitouren
    "1527004013197-933c4bb611b3",  # Frau Berg
    "1517541866997-12c5d2867a82",  # Climbing rocks
    "1522163182402-834f871fd851",  # Hiking poles
    "1502784444187-359ac186c5bb",  # Person silhouette
    "1490578474895-699cd4e2cf59",  # Trail person
    "1465311354281-2a14926e5f9f",  # Mountain top
    "1469854523086-cc02fe5d8800",  # Climber face
    "1444065381814-865dc9da92c0",  # Hiker
    "1479936343636-73cdc5aae0c3",  # Snowboard
    "1509564127755-eda04c1d1bef",  # Trail runner
    "1520962880247-cfaf541c8724",  # Sport Frau
    "1549888834-3ec93abae044",  # Outdoor Person
    "1487988142535-5d50fd5b46c5",  # Bergsteiger
    "1497436072909-60f360e1d4b1",  # Berg Klassisch
    "1494059980473-813e73ee784b",  # Climber Pose
    "1455467245-4cf30b4dcae0",  # Outdoor
    "1473773508845-188df298d2d1",  # Trail
    "1438094006-2cad57b6b4a5",  # Hiker
    "1507272931001-fc06c17e4f43",  # Berg Sonnenuntergang
    "1558611820-a7e0b1e2b84b",  # Athletin
]


def detect_gender(display_name):
    if not display_name:
        return random.choice(["m", "f"])
    first = display_name.split(" ")[0].lower()
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
    if first in female_names: return "f"
    if first.endswith(("a", "e", "ie", "in", "ina")): return "f"
    return "m"


def make_unsplash_url(photo_id):
    """Direkt-URL zu Unsplash-Foto mit 300x300 crop."""
    return f"https://images.unsplash.com/photo-{photo_id}?w=300&h=300&fit=crop&crop=faces&q=80"


def verify_pool():
    """Pruefe welche Unsplash-URLs aus dem Pool tatsaechlich existieren."""
    print(f"Pruefe {len(SPORT_PHOTOS_POOL)} Unsplash-URLs auf Erreichbarkeit...")
    working = []
    for i, pid in enumerate(SPORT_PHOTOS_POOL):
        url = make_unsplash_url(pid)
        try:
            r = requests.head(url, timeout=8, allow_redirects=True)
            if r.status_code == 200:
                working.append(pid)
                if (i + 1) % 10 == 0:
                    print(f"  [{i+1}/{len(SPORT_PHOTOS_POOL)}] {len(working)} OK bisher")
            else:
                print(f"  [{i+1}] photo-{pid}: {r.status_code} (skip)")
        except Exception as e:
            print(f"  [{i+1}] photo-{pid}: {type(e).__name__} (skip)")
    print(f"\n{len(working)}/{len(SPORT_PHOTOS_POOL)} URLs funktionieren.\n")
    return working


def make_pravatar_fallback(seed):
    """Pravatar fallback fuer wenn Unsplash-Pool zu klein ist."""
    safe_seed = requests.utils.quote(seed)
    return f"https://i.pravatar.cc/300?u={safe_seed}"


def main():
    # 1) Pool verifizieren
    working_pool = verify_pool()
    use_unsplash = len(working_pool) >= 5  # Nur sinnvoll wenn genug Bilder

    if not use_unsplash:
        print("WARNUNG: Zu wenige Unsplash-URLs erreichbar. Falle zurueck auf Pravatar.")

    # 2) Test-User holen
    print("Lade alle Test-User...")
    resp = requests.get(
        f"{REST_BASE}/user_profiles",
        headers={**HEADERS, "Prefer": "return=representation"},
        params={"is_test_user": "eq.true", "select": "id,username,display_name"},
        timeout=30,
    )
    resp.raise_for_status()
    users = resp.json()
    print(f"  {len(users)} Test-User gefunden\n")

    print(f"Update Avatare auf {'sportliche Unsplash-Fotos' if use_unsplash else 'Pravatar-Fallback'}...")
    success = 0
    fail = 0
    for i, u in enumerate(users):
        seed = u["username"] or u["id"]
        if use_unsplash:
            # Stabil pro User: Hash modulo Pool-Groesse
            idx = sum(ord(c) for c in seed) % len(working_pool)
            new_url = make_unsplash_url(working_pool[idx])
        else:
            new_url = make_pravatar_fallback(seed)

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
            print(f"  ! {u['username']}: {r.status_code}")

        if (i + 1) % 50 == 0 or i + 1 == len(users):
            print(f"  [{i+1:3d}/{len(users)}] {u['username']:30s} -> photo-{working_pool[idx] if use_unsplash else 'pravatar'}")

    print(f"\n{'='*60}")
    print(f"FERTIG  Updated: {success}  Failed: {fail}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
