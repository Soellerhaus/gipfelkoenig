// Gipfelkoenig — OSM Gipfel Import Script
// Importiert ALLE Gipfel aus den Alpen via OpenStreetMap Overpass API in Supabase
// Gesamte Alpen: Bounding Box 45.5,5.5 — 48.0,16.0

// Konfiguration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wbrvkweezbeakfphssxp.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicnZrd2VlemJlYWtmcGhzc3hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA4OTg2MSwiZXhwIjoyMDg5NjY1ODYxfQ.rIP9qn1gsgAYg9BJE7VJFBbYm0-YBXABiHhUkOChSDc'
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// Minimale Hoehe fuer Import
const MIN_ELEVATION = 500

// Gesamte Alpen in Teilregionen aufgeteilt (um Overpass-Timeouts zu vermeiden)
// Format bbox: "south,west,north,east"
// Wir teilen die Alpen in ein Raster von ca. 1.25° Laenge x 0.5° Breite
function generateSubRegions() {
  const regions = []
  const south = 45.5
  const north = 48.0
  const west = 5.5
  const east = 16.0
  const latStep = 0.5
  const lngStep = 1.5

  for (let lat = south; lat < north; lat += latStep) {
    for (let lng = west; lng < east; lng += lngStep) {
      const s = lat
      const n = Math.min(lat + latStep, north)
      const w = lng
      const e = Math.min(lng + lngStep, east)
      regions.push({
        name: `Tile ${s.toFixed(1)}-${n.toFixed(1)}N / ${w.toFixed(1)}-${e.toFixed(1)}E`,
        bbox: `${s},${w},${n},${e}`
      })
    }
  }
  return regions
}

// Region-Zuordnung basierend auf Koordinaten
function assignOsmRegion(lat, lng) {
  // AT-08 Vorarlberg
  if (lat >= 46.8 && lat <= 47.5 && lng >= 9.5 && lng <= 10.3) return 'AT-08'
  // AT-07 Tirol
  if (lat >= 46.7 && lat <= 47.6 && lng >= 10.3 && lng <= 12.8) return 'AT-07'
  // DE-BY Bayern
  if (lat >= 47.2 && lat <= 47.8 && lng >= 10.0 && lng <= 13.2) return 'DE-BY'
  // IT-32-BZ Suedtirol
  if (lat >= 46.2 && lat <= 47.1 && lng >= 10.3 && lng <= 12.5) return 'IT-32-BZ'
  // CH Schweiz
  if (lat >= 45.8 && lat <= 47.8 && lng >= 5.9 && lng <= 10.5) return 'CH'
  // Default
  return 'ALPEN'
}

async function fetchPeaksFromOSM(bbox, retries = 3) {
  const query = `[out:json][timeout:120];
node["natural"="peak"](${bbox});
out body;`

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      })

      if (response.status === 429 || response.status === 504) {
        const waitSec = attempt * 15
        console.log(`    Overpass busy (HTTP ${response.status}), warte ${waitSec}s... (Versuch ${attempt}/${retries})`)
        await sleep(waitSec * 1000)
        continue
      }

      if (!response.ok) {
        throw new Error(`Overpass API Fehler: HTTP ${response.status}`)
      }

      const data = await response.json()
      // Nur Peaks mit Namen zurueckgeben
      return data.elements.filter(el => el.tags && el.tags.name)
    } catch (err) {
      if (attempt < retries) {
        const waitSec = attempt * 10
        console.log(`    Fehler: ${err.message}, warte ${waitSec}s... (Versuch ${attempt}/${retries})`)
        await sleep(waitSec * 1000)
      } else {
        throw err
      }
    }
  }
  return []
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function transformPeak(osmPeak) {
  const elevation = osmPeak.tags.ele ? parseInt(osmPeak.tags.ele) : null
  const region = assignOsmRegion(osmPeak.lat, osmPeak.lon)
  return {
    id: osmPeak.id,
    name: osmPeak.tags.name,
    name_de: osmPeak.tags['name:de'] || null,
    lat: osmPeak.lat,
    lng: osmPeak.lon,
    elevation,
    osm_region: region,
    is_active: true
  }
}

async function upsertToSupabase(peaks, label) {
  const imported = []
  const errors = []
  const batchSize = 100

  for (let i = 0; i < peaks.length; i += batchSize) {
    const batch = peaks.slice(i, i + batchSize)
    const progress = Math.round(((i + batch.length) / peaks.length) * 100)

    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/peaks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(batch)
        }
      )

      if (response.ok) {
        imported.push(...batch)
        printProgress(label, progress, i + batch.length, peaks.length)
      } else {
        const errorText = await response.text()
        console.error(`\n    Batch-Fehler (${i}-${i + batch.length}): ${errorText.substring(0, 200)}`)
        errors.push({ batch: i, error: errorText })
      }
    } catch (err) {
      console.error(`\n    Netzwerk-Fehler: ${err.message}`)
      errors.push({ batch: i, error: err.message })
    }
  }

  return { imported: imported.length, errors: errors.length }
}

function printProgress(label, percent, current, total) {
  const bar = '#'.repeat(Math.round(percent / 5)) + '-'.repeat(20 - Math.round(percent / 5))
  process.stdout.write(`\r    [${bar}] ${percent}% (${current}/${total})`)
}

async function main() {
  console.log('===================================================')
  console.log('  Gipfelkoenig — Alpen Gipfel Import (FULL)')
  console.log('  Bounding Box: 45.5,5.5 — 48.0,16.0')
  console.log('  Mindesthoehe: ' + MIN_ELEVATION + 'm')
  console.log('===================================================\n')

  const subRegions = generateSubRegions()
  console.log(`Aufgeteilt in ${subRegions.length} Teilregionen\n`)

  let totalFetched = 0
  let totalImported = 0
  let totalFiltered = 0
  let totalErrors = 0
  const allPeaks = new Map() // Deduplizierung ueber OSM ID
  const regionStats = {}

  // Schritt 1: Alle Gipfel von OSM laden
  console.log('=== PHASE 1: Gipfel von OpenStreetMap laden ===\n')

  for (let i = 0; i < subRegions.length; i++) {
    const region = subRegions[i]
    process.stdout.write(`  [${i + 1}/${subRegions.length}] ${region.name}...`)

    try {
      const osmPeaks = await fetchPeaksFromOSM(region.bbox)
      let added = 0
      for (const peak of osmPeaks) {
        if (!allPeaks.has(peak.id)) {
          allPeaks.set(peak.id, peak)
          added++
        }
      }
      console.log(` ${osmPeaks.length} gefunden, ${added} neu (gesamt: ${allPeaks.size})`)
    } catch (err) {
      console.log(` FEHLER: ${err.message}`)
    }

    // Kleine Pause zwischen Anfragen um Overpass nicht zu ueberlasten
    if (i < subRegions.length - 1) {
      await sleep(2000)
    }
  }

  totalFetched = allPeaks.size
  console.log(`\nInsgesamt ${totalFetched} eindeutige Gipfel geladen\n`)

  // Schritt 2: Transformieren und filtern
  console.log('=== PHASE 2: Transformieren und filtern ===\n')

  const peaks = []
  let noElevation = 0

  for (const [id, osmPeak] of allPeaks) {
    const peak = transformPeak(osmPeak)

    // Filtern: nur Gipfel > MIN_ELEVATION
    if (peak.elevation === null) {
      noElevation++
      continue
    }
    if (peak.elevation < MIN_ELEVATION) {
      totalFiltered++
      continue
    }

    peaks.push(peak)

    // Statistik pro Region
    if (!regionStats[peak.osm_region]) {
      regionStats[peak.osm_region] = 0
    }
    regionStats[peak.osm_region]++
  }

  console.log(`  Gipfel mit Hoehe > ${MIN_ELEVATION}m: ${peaks.length}`)
  console.log(`  Gefiltert (< ${MIN_ELEVATION}m): ${totalFiltered}`)
  console.log(`  Ohne Hoehenangabe (uebersprungen): ${noElevation}`)
  console.log(`\n  Verteilung nach Region:`)
  for (const [region, count] of Object.entries(regionStats).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${region}: ${count} Gipfel`)
  }

  // Hoehenstatistik
  const elevations = peaks.map(p => p.elevation).filter(e => e !== null)
  if (elevations.length > 0) {
    console.log(`\n  Hoehenbereich: ${Math.min(...elevations)}m — ${Math.max(...elevations)}m`)
    const avgEle = Math.round(elevations.reduce((a, b) => a + b, 0) / elevations.length)
    console.log(`  Durchschnitt: ${avgEle}m`)
  }

  // Schritt 3: In Supabase importieren
  console.log('\n=== PHASE 3: Import in Supabase ===\n')

  if (SUPABASE_URL.includes('xxxxx')) {
    console.log('  SUPABASE_URL nicht konfiguriert — Dry-Run Modus')
    totalImported = peaks.length
  } else {
    console.log(`  Importiere ${peaks.length} Gipfel in Batches...\n`)
    const result = await upsertToSupabase(peaks, 'Import')
    totalImported = result.imported
    totalErrors = result.errors
    console.log(`\n\n  Ergebnis: ${result.imported} importiert, ${result.errors} Fehler`)
  }

  // Zusammenfassung
  console.log('\n===================================================')
  console.log('  Import abgeschlossen')
  console.log('===================================================')
  console.log(`  OSM Gipfel geladen:  ${totalFetched}`)
  console.log(`  Gefiltert (< ${MIN_ELEVATION}m): ${totalFiltered}`)
  console.log(`  Ohne Hoehe:          ${noElevation}`)
  console.log(`  Importiert:          ${totalImported} Gipfel`)
  if (totalErrors > 0) console.log(`  Fehler:              ${totalErrors}`)
  console.log(`\n  Regionen:`)
  for (const [region, count] of Object.entries(regionStats).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${region}: ${count}`)
  }
  console.log('')
}

main().catch(err => {
  console.error('Import fehlgeschlagen:', err)
  process.exit(1)
})
