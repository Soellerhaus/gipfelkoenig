# -*- coding: utf-8 -*-
"""
Bergkoenig — POI Import (Scharten, Huetten, Aussichtspunkte, etc.)
Laedt POIs aus OpenStreetMap via Overpass API und speichert in Supabase.

Usage:
  python import-pois.py --type all --limit 50000
  python import-pois.py --type hut --limit 1000
"""

import json
import urllib.request
import urllib.parse
import time
import sys

SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co'
SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc'
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

# Alpen Bounding Box
BBOX = '43.0,5.0,48.5,17.0'

# POI-Typen mit Overpass Queries
POI_TYPES = {
    'saddle': {
        'query': 'node["natural"="saddle"]({bbox});',
        'min_ele': 500,
        'label': 'Scharten/Jocher'
    },
    'hut': {
        'query': 'node["tourism"="alpine_hut"]({bbox});way["tourism"="alpine_hut"]({bbox});',
        'min_ele': 0,
        'label': 'Huetten'
    },
    'viewpoint': {
        'query': 'node["tourism"="viewpoint"]({bbox});',
        'min_ele': 500,
        'label': 'Aussichtspunkte'
    },
    'lake': {
        'query': 'way["water"="lake"]["name"](46.0,5.5,48.0,16.0);relation["water"="lake"]["name"](46.0,5.5,48.0,16.0);way["natural"="water"]["name"](46.5,5.5,48.0,16.0);',
        'min_ele': 0,
        'label': 'Bergseen'
    },
    'glacier': {
        'query': 'way["natural"="glacier"]["name"](45.5,5.5,48.0,16.0);relation["natural"="glacier"]["name"](45.5,5.5,48.0,16.0);node["natural"="glacier"]["name"](45.5,5.5,48.0,16.0);',
        'min_ele': 0,
        'label': 'Gletscher'
    },
    'via_ferrata': {
        'query': 'way["sport"="via_ferrata"]({bbox});node["sport"="via_ferrata"]({bbox});',
        'min_ele': 0,
        'label': 'Klettersteige'
    },
    'cave': {
        'query': 'node["natural"="cave_entrance"]({bbox});',
        'min_ele': 0,
        'label': 'Hoehlen'
    },
    'waterfall': {
        'query': 'node["waterway"="waterfall"]({bbox});',
        'min_ele': 0,
        'label': 'Wasserfaelle'
    },
    'chapel': {
        'query': 'node["amenity"="place_of_worship"]["name"]({bbox});',
        'min_ele': 1000,
        'label': 'Bergkapellen'
    },
    'pass': {
        'query': 'node["mountain_pass"="yes"]({bbox});',
        'min_ele': 500,
        'label': 'Paesse'
    }
}

REGION_MAP = {
    'AT-08': (46.8, 47.5, 9.5, 10.3),
    'AT-07': (46.7, 47.6, 10.3, 12.8),
    'DE-BY': (47.2, 47.8, 10.0, 13.2),
    'IT-32-BZ': (46.2, 47.1, 10.3, 12.5),
    'CH': (45.8, 47.8, 5.9, 10.5),
}


def assign_region(lat, lng):
    for region, (lat_min, lat_max, lng_min, lng_max) in REGION_MAP.items():
        if lat_min <= lat <= lat_max and lng_min <= lng <= lng_max:
            return region
    return 'ALPEN'


def fetch_pois_from_osm(poi_type, retries=3):
    config = POI_TYPES[poi_type]
    query_parts = config['query'].replace('{bbox}', BBOX)
    query = '[out:json][timeout:120];(' + query_parts + ');out center body;'

    for attempt in range(1, retries + 1):
        try:
            body = 'data=' + urllib.parse.quote(query)
            req = urllib.request.Request(OVERPASS_URL, data=body.encode('utf-8'), headers={
                'Content-Type': 'application/x-www-form-urlencoded'
            })
            resp = urllib.request.urlopen(req, timeout=180)
            data = json.loads(resp.read().decode('utf-8'))

            results = []
            for el in data.get('elements', []):
                name = el.get('tags', {}).get('name')
                if not name:
                    continue

                # Koordinaten (node vs way center)
                lat = el.get('lat') or el.get('center', {}).get('lat')
                lng = el.get('lon') or el.get('center', {}).get('lon')
                if not lat or not lng:
                    continue

                ele_str = el.get('tags', {}).get('ele', '')
                elevation = None
                try:
                    elevation = int(float(ele_str.replace(',', '.').split(';')[0]))
                except (ValueError, IndexError):
                    pass

                # Mindesthoehe filtern
                if elevation is not None and elevation < config['min_ele']:
                    continue
                # Ohne Hoehe: bei min_ele > 0 ueberspringen
                if elevation is None and config['min_ele'] > 0:
                    continue

                results.append({
                    'id': el['id'],
                    'name': name,
                    'name_de': el.get('tags', {}).get('name:de'),
                    'type': poi_type,
                    'lat': lat,
                    'lng': lng,
                    'elevation': elevation,
                    'osm_region': assign_region(lat, lng)
                })

            return results
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code == 504:
                wait = attempt * 20
                print('  Overpass busy (' + str(e.code) + '), warte ' + str(wait) + 's...')
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            if attempt < retries:
                print('  Fehler: ' + str(e) + ', retry...')
                time.sleep(10)
            else:
                raise
    return []


def upsert_to_supabase(pois, label):
    batch_size = 200
    total = 0
    errors = 0

    for i in range(0, len(pois), batch_size):
        batch = pois[i:i + batch_size]
        try:
            body = json.dumps(batch).encode('utf-8')
            req = urllib.request.Request(
                SUPABASE_URL + '/rest/v1/pois',
                data=body, method='POST',
                headers={
                    'apikey': SUPABASE_SERVICE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                }
            )
            urllib.request.urlopen(req)
            total += len(batch)
            pct = int((i + len(batch)) / len(pois) * 100)
            sys.stdout.write('\r  [' + '#' * (pct // 5) + '-' * (20 - pct // 5) + '] ' + str(pct) + '% (' + str(total) + '/' + str(len(pois)) + ')')
            sys.stdout.flush()
        except Exception as e:
            errors += 1
            print('\n  Batch-Fehler: ' + str(e)[:100])

    print()
    return total, errors


def main():
    poi_type = 'all'
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == '--type' and i < len(sys.argv) - 1:
            poi_type = sys.argv[i + 1]

    types_to_import = list(POI_TYPES.keys()) if poi_type == 'all' else [poi_type]

    print('=== Bergkoenig — POI Import ===')
    print('Typen: ' + ', '.join(types_to_import))
    print()

    grand_total = 0
    grand_errors = 0

    for t in types_to_import:
        config = POI_TYPES[t]
        print(config['label'] + ' (' + t + ')...')
        sys.stdout.flush()

        try:
            pois = fetch_pois_from_osm(t)
            print('  ' + str(len(pois)) + ' gefunden')

            if pois:
                imported, errors = upsert_to_supabase(pois, config['label'])
                grand_total += imported
                grand_errors += errors
                print('  ' + str(imported) + ' importiert, ' + str(errors) + ' Fehler')
            else:
                print('  Keine POIs gefunden')
        except Exception as e:
            print('  FEHLER: ' + str(e))
            grand_errors += 1

        # Pause zwischen Typen
        if t != types_to_import[-1]:
            time.sleep(5)

    print()
    print('=== ERGEBNIS ===')
    print('Importiert: ' + str(grand_total))
    print('Fehler: ' + str(grand_errors))


if __name__ == '__main__':
    main()
