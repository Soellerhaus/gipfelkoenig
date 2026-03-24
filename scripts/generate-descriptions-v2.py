# -*- coding: utf-8 -*-
"""
Bergkoenig - KI-Beschreibungen v2 (6 Varianten, UTF-8 fix)
Usage:
  python generate-descriptions-v2.py --region vorarlberg --limit 2000
"""

import json
import os
import urllib.request
import time
import sys
import random
import re

# === KONFIGURATION ===
CLAUDE_API_KEY = os.environ.get('CLAUDE_API_KEY', '')
CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co'
SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE'

# Regionen (lat/lng Grenzen)
REGIONS = {
    'kleinwalsertal': {'lat_min': 47.2, 'lat_max': 47.5, 'lng_min': 10.0, 'lng_max': 10.5, 'name': 'Kleinwalsertal/Allgaeu'},
    'oberengadin': {'lat_min': 46.4, 'lat_max': 46.6, 'lng_min': 9.7, 'lng_max': 10.1, 'name': 'Oberengadin'},
    'vorarlberg': {'lat_min': 46.8, 'lat_max': 47.6, 'lng_min': 9.5, 'lng_max': 10.25, 'name': 'Vorarlberg'},
    'tirol': {'lat_min': 46.8, 'lat_max': 47.5, 'lng_min': 10.25, 'lng_max': 12.5, 'name': 'Tirol'},
    'salzburg': {'lat_min': 46.8, 'lat_max': 47.8, 'lng_min': 12.5, 'lng_max': 14.0, 'name': 'Salzburg'},
    'kaernten': {'lat_min': 46.3, 'lat_max': 47.1, 'lng_min': 12.5, 'lng_max': 15.0, 'name': 'Kaernten'},
    'steiermark': {'lat_min': 46.6, 'lat_max': 47.8, 'lng_min': 14.0, 'lng_max': 16.2, 'name': 'Steiermark'},
    'suedtirol': {'lat_min': 46.2, 'lat_max': 47.1, 'lng_min': 10.4, 'lng_max': 12.5, 'name': 'Suedtirol'},
    'schweiz': {'lat_min': 45.8, 'lat_max': 47.8, 'lng_min': 5.9, 'lng_max': 10.5, 'name': 'Schweizer Alpen'},
    'frankreich': {'lat_min': 43.5, 'lat_max': 46.5, 'lng_min': 5.5, 'lng_max': 7.8, 'name': 'Franzoesische Alpen'},
    'alle': {'lat_min': 43.0, 'lat_max': 48.5, 'lng_min': 5.0, 'lng_max': 17.0, 'name': 'Alpen'},
}

# 6 Prompt-Varianten
PROMPT_VARIANTS = [
    'Erzaehle eine kurze SAGE oder LEGENDE zum Berggipfel "{name}" ({elevation}m) in {region}. Erfinde eine glaubwuerdige alpine Sage falls du keine echte kennst. 2-3 Saetze. Kein Markdown, keine Ueberschriften, nur reiner Fliesstext auf Deutsch.',

    'Was macht den Berg "{name}" ({elevation}m) in {region} GEOLOGISCH besonders? Altes Meer, Gletscher, Gesteinsformation? 2-3 Saetze. Kein Markdown, keine Ueberschriften, nur reiner Fliesstext auf Deutsch.',

    'Erzaehle etwas UEBERRASCHENDES ueber den Berg "{name}" ({elevation}m) in {region}. Ein unerwartetes Faktum, ein Rekord, eine Kurositaet. 2-3 Saetze. Kein Markdown, keine Ueberschriften, nur reiner Fliesstext auf Deutsch.',

    'Welche TIERE oder PFLANZEN leben am Berg "{name}" ({elevation}m) in {region}? Steinboecke, Murmeltiere, Edelweiss, seltene Arten? 2-3 Saetze. Kein Markdown, keine Ueberschriften, nur reiner Fliesstext auf Deutsch.',

    'Erzaehle eine HISTORISCHE Episode zum Berg "{name}" ({elevation}m) in {region}. Schmuggler, Kriege, Erstbesteigung, Hirten, Handelsrouten. 2-3 Saetze. Kein Markdown, keine Ueberschriften, nur reiner Fliesstext auf Deutsch.',

    'Was bedeutet der NAME des Berges "{name}" ({elevation}m) in {region}? Roemisch, keltisch, alemannisch, romanisch? Beginne NICHT mit "Der Name verdankt" oder aehnlich. 2-3 Saetze. Kein Markdown, keine Ueberschriften, nur reiner Fliesstext auf Deutsch.',
]


def get_peaks(region_key, limit=100):
    r = REGIONS[region_key]
    url = (SUPABASE_URL + '/rest/v1/peaks'
           '?description=is.null'
           '&lat=gte.' + str(r['lat_min']) + '&lat=lte.' + str(r['lat_max']) +
           '&lng=gte.' + str(r['lng_min']) + '&lng=lte.' + str(r['lng_max']) +
           '&select=id,name,elevation,lat,lng'
           '&order=elevation.desc.nullslast'
           '&limit=' + str(limit))
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
    })
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read().decode('utf-8'))


def generate_description(peak, region_name):
    template = random.choice(PROMPT_VARIANTS)
    prompt = template.format(
        name=peak['name'],
        elevation=peak.get('elevation') or '?',
        region=region_name
    )
    body = json.dumps({
        'model': CLAUDE_MODEL,
        'max_tokens': 150,
        'messages': [{'role': 'user', 'content': prompt}]
    }).encode('utf-8')
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=body, headers={
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
    })
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read().decode('utf-8'))
    text = result['content'][0]['text'].strip()

    # Cleanup: Markdown, Anführungszeichen, Header entfernen
    text = re.sub(r'^#+\s.*$', '', text, flags=re.MULTILINE)  # # Headlines
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)  # **bold** -> bold
    text = re.sub(r'\*([^*]+)\*', r'\1', text)  # *italic* -> italic
    text = text.strip().strip('"').strip('\u201c').strip('\u201d')
    # Mehrzeilig -> einzeilig
    text = ' '.join(line.strip() for line in text.split('\n') if line.strip())
    return text[:300]


def save_description(peak_id, description):
    url = SUPABASE_URL + '/rest/v1/peaks?id=eq.' + str(peak_id)
    body = json.dumps({'description': description}).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='PATCH', headers={
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    })
    urllib.request.urlopen(req)


def main():
    region_key = 'vorarlberg'
    limit = 2000

    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == '--region' and i < len(sys.argv) - 1:
            region_key = sys.argv[i + 1]
        elif arg == '--limit' and i < len(sys.argv) - 1:
            limit = int(sys.argv[i + 1])

    if region_key not in REGIONS:
        print('Unbekannte Region: ' + region_key)
        print('Verfuegbar: ' + ', '.join(REGIONS.keys()))
        sys.exit(1)

    region = REGIONS[region_key]
    print('Region: ' + region['name'])
    print('Limit: ' + str(limit))
    sys.stdout.flush()

    peaks = get_peaks(region_key, limit)
    print(str(len(peaks)) + ' Gipfel ohne Beschreibung')
    sys.stdout.flush()

    if not peaks:
        print('Keine Gipfel ohne Beschreibung in dieser Region!')
        return

    success = 0
    errors = 0

    for i, peak in enumerate(peaks):
        name = peak['name']
        elev = peak.get('elevation') or '?'

        try:
            desc = generate_description(peak, region['name'])
            save_description(peak['id'], desc)
            success += 1
            print(str(i + 1) + '/' + str(len(peaks)) + ' OK: ' + name + ' (' + str(elev) + 'm) -> ' + desc[:60] + '...')
            sys.stdout.flush()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print('Rate limit, warte 30s...')
                sys.stdout.flush()
                time.sleep(30)
                try:
                    desc = generate_description(peak, region['name'])
                    save_description(peak['id'], desc)
                    success += 1
                    print(str(i + 1) + '/' + str(len(peaks)) + ' OK (retry): ' + name)
                    sys.stdout.flush()
                except Exception as e2:
                    errors += 1
                    print('FEHLER (retry): ' + name + ' - ' + str(e2))
                    sys.stdout.flush()
            else:
                errors += 1
                print('FEHLER: ' + name + ' - HTTP ' + str(e.code))
                sys.stdout.flush()
        except Exception as e:
            errors += 1
            print('FEHLER: ' + name + ' - ' + str(e))
            sys.stdout.flush()

        # Pause zwischen Requests
        time.sleep(1.5)

    print()
    print('Fertig! ' + str(success) + ' OK, ' + str(errors) + ' Fehler')
    sys.stdout.flush()


if __name__ == '__main__':
    main()
