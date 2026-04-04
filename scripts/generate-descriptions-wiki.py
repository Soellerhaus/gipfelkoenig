# -*- coding: utf-8 -*-
"""
Bergkoenig - Gipfelbeschreibungen aus Wikipedia (KOSTENLOS)
Schritt 1: Wikidata-IDs aus OSM holen
Schritt 2: Wikipedia-Zusammenfassung laden
Schritt 3: Fallback-Template fuer Gipfel ohne Wikipedia

Usage:
  python generate-descriptions-wiki.py --region alle --limit 10
  python generate-descriptions-wiki.py --region vorarlberg --limit 500
"""

import json
import urllib.request
import urllib.parse
import time
import sys
import re

# === KONFIGURATION ===
SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co'
SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc'
SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwODk4NjEsImV4cCI6MjA4OTY2NTg2MX0.WDzw0d4NewgPhFopQyaQ6f3E0K-yFhOSIeDGXdVa7xE'
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

REGIONS = {
    'kleinwalsertal': {'lat_min': 47.2, 'lat_max': 47.5, 'lng_min': 10.0, 'lng_max': 10.5},
    'vorarlberg': {'lat_min': 46.8, 'lat_max': 47.6, 'lng_min': 9.5, 'lng_max': 10.25},
    'tirol': {'lat_min': 46.8, 'lat_max': 47.5, 'lng_min': 10.25, 'lng_max': 12.5},
    'salzburg': {'lat_min': 46.8, 'lat_max': 47.8, 'lng_min': 12.5, 'lng_max': 14.0},
    'suedtirol': {'lat_min': 46.2, 'lat_max': 47.1, 'lng_min': 10.4, 'lng_max': 12.5},
    'schweiz': {'lat_min': 45.8, 'lat_max': 47.8, 'lng_min': 5.9, 'lng_max': 10.5},
    'alle': {'lat_min': 43.0, 'lat_max': 48.5, 'lng_min': 5.0, 'lng_max': 17.0},
}

# Regions-Namen fuer Fallback-Beschreibungen
REGION_NAMES = {
    'AT-08': 'Vorarlberg', 'AT-07': 'Tirol', 'DE-BY': 'Bayern',
    'IT-32-BZ': 'Suedtirol', 'CH': 'Schweiz', 'ALPEN': 'den Alpen'
}


def get_peaks_without_description(region_key, limit):
    """Gipfel ohne Beschreibung aus Supabase laden"""
    r = REGIONS[region_key]
    url = (SUPABASE_URL + '/rest/v1/peaks'
           '?description=is.null'
           '&lat=gte.' + str(r['lat_min']) + '&lat=lte.' + str(r['lat_max']) +
           '&lng=gte.' + str(r['lng_min']) + '&lng=lte.' + str(r['lng_max']) +
           '&select=id,name,name_de,elevation,lat,lng,osm_region'
           '&order=elevation.desc.nullslast'
           '&limit=' + str(limit))
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
    })
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read().decode('utf-8'))


def fetch_wikidata_ids(osm_ids):
    """Wikidata-IDs fuer OSM-Nodes via Overpass holen (Batch)"""
    id_list = ','.join(str(i) for i in osm_ids)
    query = '[out:json][timeout:60];node(id:' + id_list + ');out tags;'
    body = 'data=' + urllib.parse.quote(query)
    req = urllib.request.Request(OVERPASS_URL, data=body.encode('utf-8'), headers={
        'Content-Type': 'application/x-www-form-urlencoded'
    })
    try:
        resp = urllib.request.urlopen(req, timeout=90)
        data = json.loads(resp.read().decode('utf-8'))
        result = {}
        for el in data.get('elements', []):
            tags = el.get('tags', {})
            wikidata = tags.get('wikidata')
            wikipedia = tags.get('wikipedia') or tags.get('de:wikipedia') or tags.get('wikipedia:de')
            if wikidata or wikipedia:
                result[el['id']] = {'wikidata': wikidata, 'wikipedia': wikipedia}
        return result
    except Exception as e:
        print('  Overpass Fehler: ' + str(e))
        return {}


def get_wikipedia_title_from_wikidata(wikidata_id):
    """Deutsche Wikipedia-Seite aus Wikidata-ID holen"""
    url = 'https://www.wikidata.org/wiki/Special:EntityData/' + wikidata_id + '.json'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Bergkoenig/1.0'})
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode('utf-8'))
        entity = list(data.get('entities', {}).values())[0]
        sitelinks = entity.get('sitelinks', {})
        # Deutsch bevorzugt, dann Englisch
        if 'dewiki' in sitelinks:
            return sitelinks['dewiki']['title']
        if 'enwiki' in sitelinks:
            return ('en', sitelinks['enwiki']['title'])
        return None
    except Exception:
        return None


def get_wikipedia_summary(title, lang='de'):
    """Wikipedia-Zusammenfassung ueber REST API holen"""
    encoded = urllib.parse.quote(title.replace(' ', '_'))
    url = 'https://' + lang + '.wikipedia.org/api/rest_v1/page/summary/' + encoded
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Bergkoenig/1.0 (bergkoenig.app)',
            'Accept': 'application/json'
        })
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode('utf-8'))
        extract = data.get('extract', '')
        if not extract:
            return None
        return clean_description(extract)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except Exception:
        return None


def get_wikipedia_from_tag(wiki_tag):
    """Wikipedia-Tag (z.B. 'de:Zugspitze') in Titel+Sprache aufloesen"""
    if not wiki_tag:
        return None, 'de'
    if ':' in wiki_tag:
        parts = wiki_tag.split(':', 1)
        return parts[1], parts[0]
    return wiki_tag, 'de'


MOUNTAIN_KEYWORDS = ['berg', 'gipfel', 'meter', 'hoehe', 'höhe', 'alpen', 'gebirge',
    'mountain', 'peak', 'summit', 'massiv', 'kamm', 'grat', 'horn', 'spitze',
    'wand', 'gletscher', 'klettern', 'besteigung', 'huette', 'hütte', 'tal',
    'm ü.', 'm ü.', 'erhebung', 'sattel', 'joch', 'pass ', 'fels']


def is_mountain_article(text):
    """Pruefen ob der Wikipedia-Text tatsaechlich einen Berg beschreibt"""
    lower = text.lower()
    matches = sum(1 for kw in MOUNTAIN_KEYWORDS if kw in lower)
    return matches >= 2


def search_wikipedia_by_name(peak_name):
    """Wikipedia-Suche nach Gipfelname (Fallback wenn kein Wikidata-Tag)"""
    # Bei Namen mit / beide Varianten versuchen
    names = [peak_name]
    if ' / ' in peak_name:
        names = [peak_name.split(' / ')[0].strip(), peak_name.split(' / ')[1].strip()]
    elif '/' in peak_name:
        names = [peak_name.split('/')[0].strip(), peak_name.split('/')[1].strip()]

    for name in names:
        # Mit " (Berg)" suffix zuerst (praeziser)
        desc = get_wikipedia_summary(name + ' (Berg)', 'de')
        if desc and is_mountain_article(desc):
            return desc

        # Direkt versuchen
        desc = get_wikipedia_summary(name, 'de')
        if desc and is_mountain_article(desc):
            return desc

    return None


def clean_description(text):
    """Beschreibung bereinigen und kuerzen"""
    # Nur erster Absatz (vor doppeltem Newline)
    text = text.split('\n\n')[0].strip()
    # Klammern mit Koordinaten/Referenzen entfernen
    text = re.sub(r'\([^)]*\d+°[^)]*\)', '', text)
    # Leere Klammern entfernen
    text = re.sub(r'\(\s*\)', '', text)
    # Mehrere Leerzeichen -> eins
    text = re.sub(r'\s+', ' ', text).strip()
    # Auf 300 Zeichen begrenzen (am Satzende)
    if len(text) > 300:
        cut = text[:300]
        last_dot = cut.rfind('.')
        if last_dot > 100:
            text = cut[:last_dot + 1]
        else:
            text = cut.rsplit(' ', 1)[0] + '...'
    return text


def generate_fallback(peak):
    """Einfache Template-Beschreibung aus vorhandenen Daten"""
    name = peak['name']
    elev = peak.get('elevation')
    region = REGION_NAMES.get(peak.get('osm_region', ''), 'den Alpen')

    if not elev:
        return None

    if elev >= 4000:
        return name + ' ist ein Viertausender in ' + region + '. Der Gipfel zaehlt zu den hoechsten Erhebungen der Alpen.'
    elif elev >= 3000:
        return name + ' ist ein Dreitausender in ' + region + ' und bietet eindrucksvolle Hochgebirgslandschaft mit Weitblick ueber die umliegenden Gipfel.'
    elif elev >= 2000:
        return name + ' erhebt sich auf ' + str(elev) + ' Meter in ' + region + '. Ein lohnendes Ziel fuer Bergwanderer mit Panoramablick.'
    elif elev >= 1500:
        return name + ' (' + str(elev) + 'm) in ' + region + ' ist ein beliebtes Wanderziel im Mittelgebirge.'
    else:
        return name + ' (' + str(elev) + 'm) liegt in ' + region + '.'


def save_description(peak_id, description):
    """Beschreibung in Supabase speichern"""
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
    region_key = 'alle'
    limit = 10
    dry_run = False

    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == '--region' and i < len(sys.argv) - 1:
            region_key = sys.argv[i + 1]
        elif arg == '--limit' and i < len(sys.argv) - 1:
            limit = int(sys.argv[i + 1])
        elif arg == '--dry-run':
            dry_run = True

    if region_key not in REGIONS:
        print('Unbekannte Region: ' + region_key)
        print('Verfuegbar: ' + ', '.join(REGIONS.keys()))
        sys.exit(1)

    print('=== Bergkoenig — Wikipedia-Beschreibungen ===')
    print('Region: ' + region_key + ', Limit: ' + str(limit))
    if dry_run:
        print('DRY RUN — nichts wird gespeichert')
    print()
    sys.stdout.flush()

    # 1. Gipfel ohne Beschreibung laden
    peaks = get_peaks_without_description(region_key, limit)
    print(str(len(peaks)) + ' Gipfel ohne Beschreibung geladen')
    sys.stdout.flush()

    if not peaks:
        print('Keine Gipfel ohne Beschreibung gefunden!')
        return

    # 2. Wikidata-IDs via Overpass holen (Batch, max 500 pro Query)
    print('\nWikidata-IDs von OpenStreetMap laden...')
    sys.stdout.flush()
    osm_ids = [p['id'] for p in peaks]
    wiki_map = {}
    batch_size = 300

    for i in range(0, len(osm_ids), batch_size):
        batch = osm_ids[i:i + batch_size]
        result = fetch_wikidata_ids(batch)
        wiki_map.update(result)
        print('  Batch ' + str(i // batch_size + 1) + ': ' + str(len(result)) + ' mit Wikidata/Wikipedia')
        sys.stdout.flush()
        if i + batch_size < len(osm_ids):
            time.sleep(2)

    print(str(len(wiki_map)) + ' von ' + str(len(peaks)) + ' haben Wikidata/Wikipedia-Tags')
    print()
    sys.stdout.flush()

    # 3. Fuer jeden Gipfel Beschreibung holen
    stats = {'wikipedia': 0, 'fallback': 0, 'skipped': 0, 'errors': 0}

    for i, peak in enumerate(peaks):
        name = peak['name']
        elev = peak.get('elevation') or '?'
        prefix = str(i + 1) + '/' + str(len(peaks))

        try:
            description = None
            source = None

            # Wikipedia versuchen
            wiki_info = wiki_map.get(peak['id'])
            if wiki_info:
                # Option A: Direkter Wikipedia-Tag
                wiki_tag = wiki_info.get('wikipedia')
                if wiki_tag:
                    title, lang = get_wikipedia_from_tag(wiki_tag)
                    if title:
                        description = get_wikipedia_summary(title, lang)
                        if description:
                            source = 'wikipedia'

                # Option B: Wikidata -> Wikipedia
                if not description and wiki_info.get('wikidata'):
                    wiki_title = get_wikipedia_title_from_wikidata(wiki_info['wikidata'])
                    if wiki_title:
                        if isinstance(wiki_title, tuple):
                            # Englische Wikipedia
                            description = get_wikipedia_summary(wiki_title[1], 'en')
                        else:
                            description = get_wikipedia_summary(wiki_title, 'de')
                        if description:
                            source = 'wikidata'

            # Option C: Wikipedia-Suche nach Name
            if not description:
                description = search_wikipedia_by_name(name)
                if description:
                    source = 'wikipedia'

            # Fallback: Template-Beschreibung
            if not description:
                description = generate_fallback(peak)
                if description:
                    source = 'fallback'

            if description:
                if not dry_run:
                    save_description(peak['id'], description)
                stats[source if source != 'wikidata' else 'wikipedia'] += 1
                tag = '[WIKI]' if source in ('wikipedia', 'wikidata') else '[TMPL]'
                print(prefix + ' ' + tag + ' ' + name + ' (' + str(elev) + 'm): ' + description[:80] + '...')
            else:
                stats['skipped'] += 1
                print(prefix + ' [SKIP] ' + name + ' (' + str(elev) + 'm): keine Daten')

            sys.stdout.flush()

        except Exception as e:
            stats['errors'] += 1
            print(prefix + ' [ERR] ' + name + ': ' + str(e))
            sys.stdout.flush()

        # Kleine Pause (Wikipedia Rate Limit: 200 req/s, wir sind vorsichtig)
        time.sleep(0.5)

    print()
    print('=== ERGEBNIS ===')
    print('Wikipedia:  ' + str(stats['wikipedia']))
    print('Fallback:   ' + str(stats['fallback']))
    print('Uebersprungen: ' + str(stats['skipped']))
    print('Fehler:     ' + str(stats['errors']))
    sys.stdout.flush()


if __name__ == '__main__':
    main()
