"""
Bergkoenig — KI-Beschreibungen v2 (abwechslungsreich!)
Nutzt Claude Haiku API. Region als Parameter.

Usage:
  python generate-descriptions-v2.py --region oberengadin --limit 100
  python generate-descriptions-v2.py --region kleinwalsertal --limit 1000
"""

import json
import os
import urllib.request
import time
import sys
import random

# === KONFIGURATION ===
CLAUDE_API_KEY = os.environ.get('CLAUDE_API_KEY', '')
CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co'
SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE'

# Regionen
REGIONS = {
    'kleinwalsertal': {'lat_min': 47.2, 'lat_max': 47.5, 'lng_min': 10.0, 'lng_max': 10.5, 'name': 'Kleinwalsertal/Allgaeu'},
    'oberengadin': {'lat_min': 46.4, 'lat_max': 46.6, 'lng_min': 9.7, 'lng_max': 10.1, 'name': 'Oberengadin/Engadin'},
    'tirol': {'lat_min': 46.8, 'lat_max': 47.5, 'lng_min': 10.1, 'lng_max': 12.5, 'name': 'Tirol'},
    'suedtirol': {'lat_min': 46.2, 'lat_max': 47.1, 'lng_min': 10.4, 'lng_max': 12.5, 'name': 'Suedtirol'},
    'vorarlberg': {'lat_min': 46.8, 'lat_max': 47.6, 'lng_min': 9.5, 'lng_max': 10.2, 'name': 'Vorarlberg'},
}

# 10 verschiedene Prompt-Varianten fuer Abwechslung
PROMPT_VARIANTS = [
    """Der Berggipfel "{name}" ({elevation}m) in den Alpen ({region}).
Erzaehle eine kurze, spannende SAGE oder LEGENDE zu diesem Berg. 2-3 Saetze, max 200 Zeichen.
Sei kreativ, erfinde eine glaubwuerdige alpine Sage falls du keine kennst. Auf Deutsch, nur den Text.""",

    """"{name}" ({elevation}m) in {region}.
Was macht diesen Berg GEOLOGISCH besonders? Vielleicht ein altes Meer, ein Gletscher, eine Gesteinsformation?
2-3 Saetze, max 200 Zeichen. Auf Deutsch, nur den reinen Text.""",

    """Berg "{name}" ({elevation}m), {region}.
Erzaehle etwas UEBERRASCHENDES ueber diesen Berg — ein unerwartetes Faktum, ein Rekord, eine Kuriosität.
2-3 Saetze, max 200 Zeichen. Auf Deutsch, spannend und kurz.""",

    """"{name}" ({elevation}m) in {region}.
Welche TIERE oder PFLANZEN sind hier besonders? Steinboecke, Murmeltiere, Edelweiss, seltene Orchideen?
2-3 Saetze, max 200 Zeichen. Auf Deutsch, nur den Text.""",

    """Gipfel "{name}" ({elevation}m), {region}.
Erzaehle eine HISTORISCHE Episode zu diesem Berg — Schmuggler, Kriege, Erstbesteigung, Hirten, alte Handelsrouten.
2-3 Saetze, max 200 Zeichen. Auf Deutsch, packend und kurz.""",

    """"{name}" ({elevation}m) in {region}.
Wie sieht die AUSSICHT von hier aus? Was sieht man bei klarem Wetter? Welche beruehmten Gipfel?
2-3 Saetze, max 200 Zeichen. Auf Deutsch, atmosphaerisch.""",

    """Berg "{name}" ({elevation}m), {region}.
Was bedeutet der NAME dieses Berges? Woher kommt er — roemisch, keltisch, alemannisch, romanisch?
WICHTIG: Beginne NICHT mit "Der Name verdankt" oder "verdankt seinen Namen". Sei kreativ im Satzbau.
2-3 Saetze, max 200 Zeichen. Auf Deutsch.""",

    """"{name}" ({elevation}m) in {region}.
Erzaehle etwas ueber das WETTER oder KLIMA an diesem Berg — Foehnsturm, Gewitter, Nebelmeer, Inversionslage.
2-3 Saetze, max 200 Zeichen. Auf Deutsch, nur den Text.""",

    """Berggipfel "{name}" ({elevation}m), {region}.
Was waere eine SPIELERISCHE Beschreibung dieses Berges fuer ein Bergspiel? Wie ein Sammelkarten-Text.
2-3 Saetze, max 200 Zeichen. Auf Deutsch, spannend und motivierend.""",

    """"{name}" ({elevation}m) in {region}.
Stelle dir vor du stehst auf dem Gipfel. Beschreibe das ERLEBNIS — den Wind, die Stille, das Panorama.
2-3 Saetze, max 200 Zeichen. Auf Deutsch, atmosphaerisch und poetisch.""",
]


def get_peaks(region_key, limit=100):
    r = REGIONS[region_key]
    url = (f"{SUPABASE_URL}/rest/v1/peaks"
           f"?description=is.null"
           f"&lat=gte.{r['lat_min']}&lat=lte.{r['lat_max']}"
           f"&lng=gte.{r['lng_min']}&lng=lte.{r['lng_max']}"
           f"&select=id,name,elevation,lat,lng"
           f"&order=elevation.desc.nullslast"
           f"&limit={limit}")
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': f'Bearer {SUPABASE_ANON_KEY}'
    })
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())


def generate_description(peak, region_name):
    url = 'https://api.anthropic.com/v1/messages'
    # Zufaellige Prompt-Variante waehlen
    template = random.choice(PROMPT_VARIANTS)
    prompt = template.format(
        name=peak['name'],
        elevation=peak.get('elevation', '?'),
        region=region_name
    )
    data = json.dumps({
        'model': CLAUDE_MODEL,
        'max_tokens': 150,
        'messages': [{'role': 'user', 'content': prompt}]
    }).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
    })
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    text = result['content'][0]['text'].strip()
    # Cleanup: Anfuehrungszeichen, Markdown-Header entfernen
    text = text.strip('"').strip('\u201c').strip('\u201d')
    # Markdown-Header entfernen (# Headline\n)
    lines = text.split('\n')
    cleaned = []
    for line in lines:
        line = line.strip()
        if line.startswith('#'):
            continue  # Skip Markdown headers
        if line:
            cleaned.append(line)
    text = ' '.join(cleaned)
    return text[:300]


def save_description(peak_id, description):
    url = f"{SUPABASE_URL}/rest/v1/peaks?id=eq.{peak_id}"
    data = json.dumps({'description': description}).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='PATCH', headers={
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    })
    urllib.request.urlopen(req)


def main():
    region_key = 'oberengadin'
    limit = 100

    # Parse args
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == '--region' and i < len(sys.argv) - 1:
            region_key = sys.argv[i + 1]
        elif arg == '--limit' and i < len(sys.argv) - 1:
            limit = int(sys.argv[i + 1])

    if region_key not in REGIONS:
        print(f"Unbekannte Region: {region_key}")
        print(f"Verfuegbar: {', '.join(REGIONS.keys())}")
        sys.exit(1)

    region = REGIONS[region_key]
    print(f"Region: {region['name']}")
    print(f"Limit: {limit}")
    print(f"Claude Model: {CLAUDE_MODEL}")
    print()

    peaks = get_peaks(region_key, limit)
    print(f"{len(peaks)} Gipfel ohne Beschreibung gefunden")

    success = 0
    errors = 0

    for i, peak in enumerate(peaks):
        name = peak['name']
        elev = peak.get('elevation', '?')

        try:
            desc = generate_description(peak, region['name'])
            save_description(peak['id'], desc)
            success += 1
            print(f"  [{success}/{len(peaks)}] {name} ({elev}m): {desc[:80]}...")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  Rate limit — warte 30s...")
                time.sleep(30)
                try:
                    desc = generate_description(peak, region['name'])
                    save_description(peak['id'], desc)
                    success += 1
                    print(f"  [{success}/{len(peaks)}] {name} ({elev}m): {desc[:80]}...")
                except Exception as e2:
                    errors += 1
                    print(f"  FEHLER {name}: {e2}")
            else:
                errors += 1
                print(f"  FEHLER {name}: HTTP {e.code}")
        except Exception as e:
            errors += 1
            print(f"  FEHLER {name}: {e}")

        # Kurze Pause zwischen Requests
        if i < len(peaks) - 1:
            time.sleep(1.5)

    print(f"\nFertig! {success} OK, {errors} Fehler")


if __name__ == '__main__':
    main()
