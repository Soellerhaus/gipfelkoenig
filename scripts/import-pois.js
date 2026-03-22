/**
 * Import mountain passes, saddles, and alpine huts from OpenStreetMap
 * into the Supabase peaks table for the entire Alps region.
 *
 * Uses larger tiles (1° x 1°) and longer delays to avoid Overpass rate limits.
 * Alternates between Overpass endpoints for better throughput.
 */

const { createClient } = require('@supabase/supabase-js');

// --- Config ---
const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Alps bounding box
const BBOX = { south: 45.5, west: 5.5, north: 48.0, east: 16.0 };
const TILE_SIZE = 1.0; // 1 degree tiles = ~28 tiles total

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Region assignment based on coordinates ---
function getOsmRegion(lat, lng) {
  if (lat >= 46.8 && lat <= 47.6 && lng >= 9.5 && lng <= 10.3) return 'AT-08';
  if (lat >= 46.6 && lat <= 47.8 && lng >= 10.1 && lng <= 12.97) return 'AT-07';
  if (lat >= 46.9 && lat <= 47.9 && lng >= 12.0 && lng <= 14.0) return 'AT-05';
  if (lat >= 46.3 && lat <= 47.2 && lng >= 12.6 && lng <= 15.1) return 'AT-02';
  if (lat >= 46.6 && lat <= 47.9 && lng >= 13.5 && lng <= 16.2) return 'AT-06';
  if (lat >= 46.2 && lat <= 47.1 && lng >= 10.4 && lng <= 12.5) return 'IT-32-BZ';
  if (lat >= 45.6 && lat <= 46.5 && lng >= 10.4 && lng <= 12.0) return 'IT-32-TN';
  if (lat >= 47.2 && lat <= 48.0 && lng >= 10.0 && lng <= 13.5) return 'DE-BY';
  if (lat >= 45.8 && lat <= 47.9 && lng >= 5.9 && lng <= 10.5) return 'CH';
  if (lng < 7.0 && lat < 47.0) return 'FR';
  if (lat >= 45.5 && lat <= 46.9 && lng >= 13.3 && lng <= 16.6) return 'SI';
  if (lat >= 47.04 && lat <= 47.27 && lng >= 9.47 && lng <= 9.64) return 'LI';
  return 'ALPEN';
}

function buildTiles() {
  const tiles = [];
  for (let south = BBOX.south; south < BBOX.north; south += TILE_SIZE) {
    for (let west = BBOX.west; west < BBOX.east; west += TILE_SIZE) {
      tiles.push({
        south: Math.round(south * 10) / 10,
        west: Math.round(west * 10) / 10,
        north: Math.round(Math.min(south + TILE_SIZE, BBOX.north) * 10) / 10,
        east: Math.round(Math.min(west + TILE_SIZE, BBOX.east) * 10) / 10,
      });
    }
  }
  return tiles;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let endpointIndex = 0;

async function queryOverpass(tile, retries = 4) {
  const bbox = `${tile.south},${tile.west},${tile.north},${tile.east}`;
  const query = `
[out:json][timeout:120];
(
  node["natural"="saddle"](${bbox});
  node["mountain_pass"="yes"](${bbox});
  node["tourism"="alpine_hut"](${bbox});
);
out body;`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[endpointIndex % OVERPASS_ENDPOINTS.length];
    endpointIndex++;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(120000),
      });

      if (res.status === 429 || res.status === 504) {
        const wait = attempt * 20000;
        console.log(`  [${new URL(endpoint).hostname}] ${res.status}, retry in ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      return data.elements || [];
    } catch (err) {
      if (attempt < retries) {
        const wait = attempt * 15000;
        console.log(`  Attempt ${attempt} failed (${err.message}), retry in ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        console.error(`  FAILED after ${retries} attempts: ${err.message}`);
        return [];
      }
    }
  }
  return [];
}

function getFeatureType(element) {
  const tags = element.tags || {};
  if (tags.mountain_pass === 'yes') return 'pass';
  if (tags.natural === 'saddle') return 'saddle';
  if (tags.tourism === 'alpine_hut') return 'hut';
  return null;
}

function toRow(element) {
  const tags = element.tags || {};
  if (!tags.name) return null;

  const type = getFeatureType(element);
  if (!type) return null;

  const elevation = tags.ele ? parseInt(tags.ele, 10) : null;

  return {
    id: element.id,
    name: tags.name,
    lat: element.lat,
    lng: element.lon,
    elevation: isNaN(elevation) ? null : elevation,
    osm_region: getOsmRegion(element.lat, element.lon),
    difficulty: type,
    is_active: true,
    season_from: '01-01',
    season_to: '12-31',
  };
}

async function upsertBatch(rows) {
  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from('peaks')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

  if (error) {
    console.error(`  Supabase error: ${error.message}`);
    return 0;
  }
  return rows.length;
}

async function main() {
  console.log('=== Importing POIs from OpenStreetMap into Supabase ===');
  console.log(`Bounding box: ${BBOX.south},${BBOX.west} -> ${BBOX.north},${BBOX.east}`);

  const tiles = buildTiles();
  console.log(`Split into ${tiles.length} tiles (${TILE_SIZE}° x ${TILE_SIZE}°)\n`);

  const stats = { passes: 0, saddles: 0, huts: 0, skippedNoName: 0, upserted: 0 };
  const seenIds = new Set();
  let buffer = [];

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    process.stdout.write(`[${i + 1}/${tiles.length}] ${tile.south},${tile.west}-${tile.north},${tile.east} ... `);

    const elements = await queryOverpass(tile);
    let tileNew = 0;

    for (const el of elements) {
      if (!el.tags?.name) { stats.skippedNoName++; continue; }
      if (seenIds.has(el.id)) continue;
      seenIds.add(el.id);

      const row = toRow(el);
      if (!row) continue;

      if (row.difficulty === 'pass') stats.passes++;
      else if (row.difficulty === 'saddle') stats.saddles++;
      else if (row.difficulty === 'hut') stats.huts++;

      buffer.push(row);
      tileNew++;
    }

    console.log(`${elements.length} elements, ${tileNew} new`);

    if (buffer.length >= 500) {
      const batch = buffer.splice(0, 500);
      const n = await upsertBatch(batch);
      stats.upserted += n;
      console.log(`  -> Upserted ${batch.length}`);
    }

    // Wait between tiles to avoid rate limits
    if (i < tiles.length - 1) {
      await sleep(8000);
    }
  }

  // Flush remaining
  if (buffer.length > 0) {
    const n = await upsertBatch(buffer);
    stats.upserted += n;
    console.log(`  -> Upserted final ${buffer.length}`);
  }

  const total = stats.passes + stats.saddles + stats.huts;
  console.log('\n=== Import Complete ===');
  console.log(`Total unique named features: ${total}`);
  console.log(`  Passes (mountain_pass=yes): ${stats.passes}`);
  console.log(`  Saddles (natural=saddle):   ${stats.saddles}`);
  console.log(`  Huts (tourism=alpine_hut):  ${stats.huts}`);
  console.log(`Skipped (no name): ${stats.skippedNoName}`);
  console.log(`Upserted to Supabase: ${stats.upserted}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
