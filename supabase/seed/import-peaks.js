// Gipfelkönig — OSM Gipfel Import Script
// Importiert Gipfel aus OpenStreetMap Overpass API in Supabase
// Aktuell: Nur Kleinwalsertal (erweiterbar auf gesamte Alpen)

// Konfiguration — Supabase Credentials aus Umgebungsvariablen oder manuell setzen
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xxxxx.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_SERVICE_ROLE_KEY'
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// Region: Kleinwalsertal
const REGIONS = [
  {
    name: 'Kleinwalsertal',
    osm_region: 'AT-08',
    bbox: '47.32,10.08,47.42,10.25'
  }
  // Weitere Regionen können hier hinzugefügt werden:
  // { name: 'Vorarlberg', osm_region: 'AT-08', bbox: '46.84,9.52,47.59,10.24' },
  // { name: 'Tirol', osm_region: 'AT-07', bbox: '46.65,10.09,47.75,12.97' },
  // { name: 'Bayern', osm_region: 'DE-BY', bbox: '47.27,10.18,47.73,13.84' },
  // { name: 'Südtirol', osm_region: 'IT-32-BZ', bbox: '46.22,10.38,47.09,12.48' },
]

async function fetchPeaksFromOSM(bbox) {
  const query = `[out:json][timeout:60];
node["natural"="peak"](${bbox});
out body;`

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query)
  })

  if (!response.ok) {
    throw new Error(`Overpass API Fehler: HTTP ${response.status}`)
  }

  const data = await response.json()
  return data.elements.filter(el => el.tags && el.tags.name)
}

function transformPeak(osmPeak, osmRegion) {
  const elevation = osmPeak.tags.ele ? parseInt(osmPeak.tags.ele) : null
  return {
    id: osmPeak.id,
    name: osmPeak.tags.name,
    name_de: osmPeak.tags['name:de'] || null,
    lat: osmPeak.lat,
    lng: osmPeak.lon,
    elevation,
    osm_region: osmRegion,
    is_active: true,
    // PostGIS Geometry als WKT (Well-Known Text)
    geom: `SRID=4326;POINT(${osmPeak.lon} ${osmPeak.lat})`
  }
}

async function upsertToSupabase(peaks) {
  // Da wir keinen Supabase JS Client als Dependency haben,
  // nutzen wir die REST API direkt
  const imported = []
  const errors = []
  const batchSize = 50

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
        printProgress(progress, batch.length, peaks.length)
      } else {
        const errorText = await response.text()
        console.error(`\n  Batch-Fehler (${i}-${i + batch.length}): ${errorText}`)
        errors.push({ batch: i, error: errorText })
      }
    } catch (err) {
      console.error(`\n  Netzwerk-Fehler: ${err.message}`)
      errors.push({ batch: i, error: err.message })
    }
  }

  return { imported: imported.length, errors: errors.length }
}

function printProgress(percent, batchCount, total) {
  const bar = '█'.repeat(Math.round(percent / 5)) + '░'.repeat(20 - Math.round(percent / 5))
  process.stdout.write(`\r  [${bar}] ${percent}% (${batchCount}/${total})`)
}

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  Gipfelkönig — OSM Gipfel Import')
  console.log('═══════════════════════════════════════════════\n')

  let totalImported = 0
  let totalErrors = 0

  for (const region of REGIONS) {
    console.log(`→ Region: ${region.name} (${region.osm_region})`)
    console.log(`  Bounding Box: ${region.bbox}`)

    // Schritt 1: Gipfel von OSM laden
    console.log('  Lade Gipfel von OpenStreetMap...')
    const osmPeaks = await fetchPeaksFromOSM(region.bbox)
    console.log(`  ✓ ${osmPeaks.length} Gipfel gefunden\n`)

    // Schritt 2: Transformieren
    const peaks = osmPeaks.map(p => transformPeak(p, region.osm_region))

    // Höhenstatistik
    const withElevation = peaks.filter(p => p.elevation !== null)
    const maxEle = withElevation.length > 0 ? Math.max(...withElevation.map(p => p.elevation)) : 0
    const minEle = withElevation.length > 0 ? Math.min(...withElevation.map(p => p.elevation)) : 0
    console.log(`  Höhenbereich: ${minEle}m — ${maxEle}m`)
    console.log(`  Mit Höhenangabe: ${withElevation.length}/${peaks.length}\n`)

    // Schritt 3: In Supabase importieren (Dry-Run wenn keine Credentials)
    if (SUPABASE_URL.includes('xxxxx')) {
      console.log('  ⚠ SUPABASE_URL nicht konfiguriert — Dry-Run Modus')
      console.log('  Setze SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY als Umgebungsvariablen.')
      console.log(`\n  Würde ${peaks.length} Gipfel importieren. Beispiele:`)
      peaks.slice(0, 5).forEach(p => {
        console.log(`    • ${p.name} (${p.elevation || '?'}m) [${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}]`)
      })
      totalImported += peaks.length
    } else {
      console.log('  Importiere in Supabase...')
      const result = await upsertToSupabase(peaks)
      console.log(`\n  ✓ ${result.imported} importiert, ${result.errors} Fehler`)
      totalImported += result.imported
      totalErrors += result.errors
    }

    console.log('')
  }

  // Zusammenfassung
  console.log('═══════════════════════════════════════════════')
  console.log('  Import abgeschlossen')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Regionen:    ${REGIONS.length}`)
  console.log(`  Importiert:  ${totalImported} Gipfel`)
  if (totalErrors > 0) console.log(`  Fehler:      ${totalErrors}`)
  console.log('')
}

main().catch(err => {
  console.error('Import fehlgeschlagen:', err)
  process.exit(1)
})
