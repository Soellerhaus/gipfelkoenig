/**
 * Import mountain passes, saddles, and alpine huts from OpenStreetMap
 * into the Supabase peaks table for the entire Alps region.
 *
 * Splits the Alps bounding box into smaller tiles to avoid Overpass API timeouts.
 */

const { createClient } = require('@supabase/supabase-js');

// --- Config ---
const SUPABASE_URL = 'https://wbrvkweezbeakfphssxp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Alps bounding box
const BBOX = { south: 45.5, west: 5.5, north: 48.0, east: 16.0 };

// Tile size in degrees (0.5 x 0.5 degree tiles)
const TILE_SIZE = 0.5;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Region assignment based on coordinates ---
function getOsmRegion(lat, lng) {
  // Vorarlberg (AT-08)
  if (lat >= 46.8 && lat <= 47.6 && lng >= 9.5 && lng <= 10.3) return 'AT-08';
  // Tirol (AT-07)
  if (lat >= 46.6 && lat <= 47.8 && lng >= 10.1 && lng <= 12.97) return 'AT-07';
  // Salzburg (AT-05)
  if (lat >= 46.9 && lat <= 47.9 && lng >= 12.0 && lng <= 14.0) return 'AT-05';
  // Kärnten (AT-02)
  if (lat >= 46.3 && lat <= 47.2 && lng >= 12.6 && lng <= 15.1) return 'AT-02';
  // Steiermark (AT-06)
  if (lat >= 46.6 && lat <= 47.9 && lng >= 13.5 && lng <= 16.2) return 'AT-06';
  // Südtirol (IT-32-BZ)
  if (lat >= 46.2 && lat <= 47.1 && lng >= 10.4 && lng <= 12.5) return 'IT-32-BZ';
  // Trentino (IT-32-TN)
  if (lat >= 45.6 && lat <= 46.5 && lng >= 10.4 && lng <= 12.0) return 'IT-32-TN';
  // Bayern (DE-BY)
  if (lat >= 47.2 && lat <= 48.0 && lng >= 10.0 && lng <= 13.5) return 'DE-BY';
  // Switzerland (CH)
  if (lat >= 45.8 && lat <= 47.9 && lng >= 5.9 && lng <= 10.5) return 'CH';
  // France (FR)
  if (lng < 7.0 && lat < 47.0) return 'FR';
  // Slovenia (SI)
  if (lat >= 45.5 && lat <= 46.9 && lng >= 13.3 && lng <= 16.6) return 'SI';
  // Liechtenstein (LI)
  if (lat >= 47.04 && lat <= 47.27 && lng >= 9.47 && lng <= 9.64) return 'LI';
  return 'ALPEN';
}

// --- Build tiles ---
function buildTiles() {
  const tiles = [];
  for (let south = BBOX.south; south < BBOX.north; south += TILE_SIZE) {
    for (let west = BBOX.west; west < BBOX.east; west += TILE_SIZE) {
      tiles.push({
        south: Math.round(south * 100) / 100,
        west: Math.round(west * 100) / 100,
        north: Math.round(Math.min(south + TILE_SIZE, BBOX.north) * 100) / 100,
        east: Math.round(Math.min(west + TILE_SIZE, BBOX.east) * 100) / 100,
      });
    }
  }
  return tiles;
}

// --- Query Overpass API for one tile ---
async function queryOverpass(tile, retries = 3) {
  const bbox = `${tile.south},${tile.west},${tile.north},${tile.east}`;
  const query = `
[out:json][timeout:60];
(
  node["natural"="saddle"](${bbox});
  node["mountain_pass"="yes"](${bbox});
  node["tourism"="alpine_hut"](${bbox});
);
out body;`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(90000),
      });

      if (res.status === 429 || res.status === 504) {
        const wait = attempt * 15000;
        console.log(`  Rate limited/timeout (${res.status}), waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      return data.elements || [];
    } catch (err) {
      if (attempt < retries) {
        const wait = attempt * 10000;
        console.log(`  Attempt ${attempt} failed: ${err.message}. Retrying in ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        console.error(`  FAILED after ${retries} attempts: ${err.message}`);
        return [];
      }
    }
  }
  return [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Determine feature type ---
function getFeatureType(element) {
  const tags = element.tags || {};
  if (tags.mountain_pass === 'yes') return 'pass';
  if (tags.natural === 'saddle') return 'saddle';
  if (tags.tourism === 'alpine_hut') return 'hut';
  return null;
}

// --- Transform OSM element to peaks row ---
function toRow(element) {
  const tags = element.tags || {};
  const name = tags.name;
  if (!name) return null;

  const type = getFeatureType(element);
  if (!type) return null;

  const elevation = tags.ele ? parseInt(tags.ele, 10) : null;

  return {
    id: element.id,
    name,
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

// --- Upsert batch into Supabase ---
async function upsertBatch(rows) {
  if (rows.length === 0) return 0;

  // Upsert with onConflict on id, ignoreDuplicates to not overwrite existing peaks
  const { error, count } = await supabase
    .from('peaks')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' });

  if (error) {
    console.error(`  Supabase error: ${error.message}`);
    return 0;
  }
  return count || rows.length;
}

// --- Main ---
async function main() {
  console.log('=== Importing POIs from OpenStreetMap into Supabase ===');
  console.log(`Bounding box: ${BBOX.south},${BBOX.west} -> ${BBOX.north},${BBOX.east}`);

  const tiles = buildTiles();
  console.log(`Split into ${tiles.length} tiles (${TILE_SIZE}° x ${TILE_SIZE}°)\n`);

  const stats = { passes: 0, saddles: 0, huts: 0, skippedNoName: 0, total: 0, upserted: 0 };
  const seenIds = new Set();
  let allRows = [];

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    process.stdout.write(`[${i + 1}/${tiles.length}] Tile ${tile.south},${tile.west}-${tile.north},${tile.east} ... `);

    const elements = await queryOverpass(tile);
    let tileRows = 0;

    for (const el of elements) {
      if (!el.tags || !el.tags.name) {
        stats.skippedNoName++;
        continue;
      }
      if (seenIds.has(el.id)) continue;
      seenIds.add(el.id);

      const row = toRow(el);
      if (!row) continue;

      if (row.difficulty === 'pass') stats.passes++;
      else if (row.difficulty === 'saddle') stats.saddles++;
      else if (row.difficulty === 'hut') stats.huts++;

      allRows.push(row);
      tileRows++;
    }

    console.log(`${elements.length} elements, ${tileRows} new named features`);

    // Upsert in batches of 500
    if (allRows.length >= 500) {
      const batch = allRows.splice(0, 500);
      const n = await upsertBatch(batch);
      stats.upserted += n;
      console.log(`  -> Upserted batch of ${batch.length}`);
    }

    // Small delay between tiles to be polite to Overpass API
    if (i < tiles.length - 1) {
      await sleep(1500);
    }
  }

  // Upsert remaining rows
  if (allRows.length > 0) {
    const n = await upsertBatch(allRows);
    stats.upserted += n;
    console.log(`  -> Upserted final batch of ${allRows.length}`);
  }

  stats.total = stats.passes + stats.saddles + stats.huts;

  console.log('\n=== Import Complete ===');
  console.log(`Total unique named features: ${stats.total}`);
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
