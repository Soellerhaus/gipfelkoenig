"""
Gipfelkoenig — KI-Beschreibungen fuer Gipfel generieren
Nutzt Claude Haiku API um kurze Anekdoten/Sagen zu generieren.

Usage: python generate-descriptions.py [--batch-size 50] [--delay 2]
"""

import json
import os
import urllib.request
import time
import sys

# === KONFIGURATION ===
CLAUDE_API_KEY = os.environ.get('CLAUDE_API_KEY', '')
CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
SUPABASE_PROJECT = 'wbrvkweezbeakfphssxp'
SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co'
SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE'

BATCH_SIZE = 50
DELAY_BETWEEN = 1  # Claude Haiku ist schnell

PROMPT_TEMPLATE = """Schreibe eine kurze, spannende Beschreibung (2-3 Saetze, maximal 200 Zeichen) fuer den Berggipfel "{name}" ({elevation}m) in den Alpen (ca. {lat}, {lng}).

Waehle EINES davon:
- Eine historische Anekdote oder Sage
- Eine geologische Besonderheit
- Etwas ueber Tier- oder Pflanzenwelt
- Eine Namensherkunft
- Ein ueberraschendes Faktum

Nur den reinen Text auf Deutsch, keine Anfuehrungszeichen. Kurz und spannend wie ein Spielkarten-Text."""


def get_peaks_without_description(limit=50):
    # Nur Kleinwalsertal/Allgaeu Region (lat 47.2-47.5, lng 10.0-10.5)
    url = (f"{SUPABASE_URL}/rest/v1/peaks"
           f"?description=is.null"
           f"&elevation=not.is.null"
           f"&lat=gte.47.2&lat=lte.47.5"
           f"&lng=gte.10.0&lng=lte.10.5"
           f"&select=id,name,elevation,lat,lng"
           f"&order=elevation.desc"
           f"&limit={limit}")
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': f'Bearer {SUPABASE_ANON_KEY}'
    })
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())


def generate_description(peak):
    url = 'https://api.anthropic.com/v1/messages'
    prompt = PROMPT_TEMPLATE.format(
        name=peak['name'],
        elevation=peak['elevation'],
        lat=round(peak['lat'], 2),
        lng=round(peak['lng'], 2)
    )
    data = json.dumps({
        'model': CLAUDE_MODEL,
        'max_tokens': 120,
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
    # Umlaute fixen falls noetig
    return text[:250]


def save_description(peak_id, description):
    # Via Supabase REST API mit Service Role Key (umgeht RLS)
    url = f"{SUPABASE_URL}/rest/v1/peaks?id=eq.{peak_id}"
    data = json.dumps({'description': description}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }, method='PATCH')
    urllib.request.urlopen(req)


def main():
    batch_size = BATCH_SIZE
    delay = DELAY_BETWEEN
    for i, arg in enumerate(sys.argv):
        if arg == '--batch-size' and i + 1 < len(sys.argv):
            batch_size = int(sys.argv[i + 1])
        if arg == '--delay' and i + 1 < len(sys.argv):
            delay = int(sys.argv[i + 1])

    print(f"=== Gipfelkoenig Beschreibungs-Generator (Claude Haiku) ===")
    print(f"Batch: {batch_size} | Delay: {delay}s")

    total_done = 0
    total_errors = 0

    while True:
        peaks = get_peaks_without_description(limit=batch_size)
        if not peaks:
            print(f"\nFertig! {total_done} Beschreibungen generiert, {total_errors} Fehler.")
            break

        print(f"\n--- Batch: {len(peaks)} Gipfel ---")
        for peak in peaks:
            try:
                desc = generate_description(peak)
                save_description(peak['id'], desc)
                total_done += 1
                print(f"  [{total_done}] {peak['name']} ({peak['elevation']}m): {desc[:70]}...")
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print(f"  RATE LIMIT — warte 30s...")
                    time.sleep(30)
                    try:
                        desc = generate_description(peak)
                        save_description(peak['id'], desc)
                        total_done += 1
                        print(f"  [{total_done}] {peak['name']}: {desc[:70]}...")
                    except:
                        total_errors += 1
                        print(f"  SKIP {peak['name']}")
                else:
                    total_errors += 1
                    print(f"  ERROR {peak['name']}: HTTP {e.code}")
            except Exception as e:
                total_errors += 1
                print(f"  ERROR {peak['name']}: {e}")
            time.sleep(delay)

        print(f"  Total: {total_done} OK, {total_errors} Fehler")


if __name__ == '__main__':
    main()
