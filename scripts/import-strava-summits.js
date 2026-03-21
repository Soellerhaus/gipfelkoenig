#!/usr/bin/env node

// Gipfelkoenig — Strava Massenimport: Alle Aktivitaeten → Gipfel-Erkennung
// Liest saemtliche Strava-Aktivitaeten, prueft GPS-Punkte gegen Gipfel-DB,
// und speichert erkannte Gipfel in die summits-Tabelle.
// Keine externen Abhaengigkeiten — nutzt nur Node.js built-in fetch.

// ============================================================
// Umgebungsvariablen
// ============================================================

const STRAVA_ACCESS_TOKEN = process.env.STRAVA_ACCESS_TOKEN
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_USER_ID = process.env.SUPABASE_USER_ID

if (!STRAVA_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_USER_ID) {
  console.error('Fehler: Folgende Umgebungsvariablen muessen gesetzt sein:')
  console.error('  STRAVA_ACCESS_TOKEN    — Strava OAuth Access Token')
  console.error('  SUPABASE_URL           — z.B. https://xxxxx.supabase.co')
  console.error('  SUPABASE_SERVICE_ROLE_KEY — Supabase Service Role Key')
  console.error('  SUPABASE_USER_ID       — UUID des Benutzers in Supabase')
  process.exit(1)
}

// Erlaubte Aktivitaetstypen (Wandern, Laufen, Gehen, Trailrunning, Ski)
const ALLOWED_TYPES = new Set([
  'Hike', 'Run', 'Walk', 'TrailRun',
  'AlpineSki', 'NordicSki',
  // Strava liefert manchmal auch sport_type statt type
  'Trail Run', 'Alpine Ski', 'Nordic Ski'
])

// Strava Rate-Limit: 100 Requests / 15 Min → 9 Sek. Pause zwischen Stream-Requests
const STREAM_DELAY_MS = 9000

// Gipfel-Erkennungsradius in Metern
const PEAK_RADIUS_M = 80

// ============================================================
// Hilfsfunktionen
// ============================================================

/**
 * Haversine-Distanz zwischen zwei Koordinaten in Metern
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000 // Erdradius in Metern
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Saison aus einem Datum berechnen (= Jahreszahl als String)
 */
function getSeason(date) {
  return date.getFullYear().toString()
}

/**
 * Punkte-Berechnung (Kernformel aus process-activity)
 * elevation als Basis, Multiplikatoren fuer Erst-/Saisonbesuch/Wiederholung,
 * Heimat-Bonus fuer AT-08
 */
function calculatePoints(elevation, isSeasonFirst, isPersonalFirst, osmRegion) {
  let points = elevation || 1000

  if (isSeasonFirst) {
    points *= 3           // Erster Besuch dieser Saison ueberhaupt
  } else if (isPersonalFirst) {
    points *= 1.5         // Persoenlich erster Besuch
  } else {
    points *= 0.2         // Wiederholung
  }

  // Heimat-Bonus Vorarlberg
  if (osmRegion === 'AT-08') {
    points += 100
  }

  return Math.round(points)
}

/**
 * Wartet die angegebene Anzahl Millisekunden
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================
// Strava API
// ============================================================

/**
 * Holt eine Seite von Strava-Aktivitaeten (paginiert, max 100 pro Seite)
 */
async function fetchStravaActivities(page) {
  const url = `https://www.strava.com/api/v3/athlete/activities?per_page=100&page=${page}`
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${STRAVA_ACCESS_TOKEN}` }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Strava Aktivitaeten-Fehler (Seite ${page}): HTTP ${res.status} — ${text}`)
  }

  return res.json()
}

/**
 * Holt ALLE Aktivitaeten von Strava (alle Seiten)
 */
async function fetchAllStravaActivities() {
  const allActivities = []
  let page = 1

  while (true) {
    console.log(`  Lade Aktivitaeten — Seite ${page}...`)
    const activities = await fetchStravaActivities(page)

    if (!activities || activities.length === 0) break

    allActivities.push(...activities)
    console.log(`    → ${activities.length} Aktivitaeten geladen (gesamt: ${allActivities.length})`)

    // Weniger als 100 = letzte Seite
    if (activities.length < 100) break
    page++
  }

  return allActivities
}

/**
 * Holt den GPS-Stream (latlng + time) fuer eine Aktivitaet von Strava
 */
async function fetchStravaStream(activityId) {
  const url = `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=latlng,time&key_type=stream`
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${STRAVA_ACCESS_TOKEN}` }
  })

  if (!res.ok) {
    // 404 kann vorkommen wenn Aktivitaet keine GPS-Daten hat
    if (res.status === 404) return null
    const text = await res.text()
    throw new Error(`Strava Stream-Fehler (Aktivitaet ${activityId}): HTTP ${res.status} — ${text}`)
  }

  return res.json()
}

// ============================================================
// Supabase REST API
// ============================================================

// Standard-Header fuer alle Supabase-Requests
const supabaseHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
}

/**
 * Laedt alle Gipfel aus der peaks-Tabelle
 * Nutzt Paginierung da Supabase standardmaessig max 1000 Zeilen liefert
 */
async function loadAllPeaks() {
  const allPeaks = []
  let offset = 0
  const limit = 1000

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/peaks?select=id,name,lat,lng,elevation,osm_region&order=id&offset=${offset}&limit=${limit}`
    const res = await fetch(url, { headers: supabaseHeaders })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase peaks-Fehler: HTTP ${res.status} — ${text}`)
    }

    const peaks = await res.json()
    if (!peaks || peaks.length === 0) break

    allPeaks.push(...peaks)
    if (peaks.length < limit) break
    offset += limit
  }

  return allPeaks
}

/**
 * Prueft ob ein Summit fuer diesen User+Peak bereits existiert (personal first)
 */
async function checkPersonalFirst(peakId) {
  const url = `${SUPABASE_URL}/rest/v1/summits?select=id&user_id=eq.${SUPABASE_USER_ID}&peak_id=eq.${peakId}&limit=1`
  const res = await fetch(url, { headers: supabaseHeaders })

  if (!res.ok) return false

  const data = await res.json()
  return data.length === 0
}

/**
 * Prueft ob ein Summit fuer diesen Peak in dieser Saison bereits existiert (season first)
 */
async function checkSeasonFirst(peakId, season) {
  const url = `${SUPABASE_URL}/rest/v1/summits?select=id&peak_id=eq.${peakId}&season=eq.${season}&limit=1`
  const res = await fetch(url, { headers: supabaseHeaders })

  if (!res.ok) return false

  const data = await res.json()
  return data.length === 0
}

/**
 * Upsert eines Summits in die summits-Tabelle
 * Nutzt strava_activity_id + peak_id + user_id als Unique-Kriterium
 */
async function upsertSummit(summitData) {
  const url = `${SUPABASE_URL}/rest/v1/summits`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseHeaders,
      // Upsert: Bei Duplikat (gleiche Aktivitaet + Peak + User) aktualisieren
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(summitData)
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`    Supabase upsert-Fehler: ${text}`)
    return false
  }

  return true
}

// ============================================================
// Gipfelerkennung — Kernlogik
// ============================================================

/**
 * Findet alle Gipfel die innerhalb des Radius eines GPS-Punktes liegen
 * Gibt eine Map zurueck: peakId → { peak, timeOffset }
 */
function findPeaksInStream(latlngData, timeData, peaks, activityStart) {
  const foundPeaks = new Map()

  // Jeden GPS-Punkt pruefen (alle Punkte, nicht nur jeden 10.)
  for (let i = 0; i < latlngData.length; i++) {
    const [lat, lng] = latlngData[i]
    const timeOffset = timeData ? timeData[i] : 0

    for (const peak of peaks) {
      // Bereits gefundene Gipfel ueberspringen
      if (foundPeaks.has(peak.id)) continue

      const dist = haversineDistance(lat, lng, peak.lat, peak.lng)
      if (dist <= PEAK_RADIUS_M) {
        foundPeaks.set(peak.id, {
          peak,
          timeOffset,
          distance: Math.round(dist)
        })
      }
    }
  }

  return foundPeaks
}

// ============================================================
// Hauptprogramm
// ============================================================

async function main() {
  console.log('================================================================')
  console.log('  Gipfelkoenig — Strava Massenimport')
  console.log('================================================================')
  console.log(`  User-ID:  ${SUPABASE_USER_ID}`)
  console.log(`  Supabase: ${SUPABASE_URL}`)
  console.log('')

  // Schritt 1: Alle Gipfel aus Supabase laden
  console.log('[1/4] Lade Gipfel aus Supabase...')
  const peaks = await loadAllPeaks()
  console.log(`  → ${peaks.length} Gipfel geladen\n`)

  if (peaks.length === 0) {
    console.error('Keine Gipfel in der Datenbank gefunden. Zuerst import-peaks.js ausfuehren!')
    process.exit(1)
  }

  // Schritt 2: Alle Strava-Aktivitaeten holen
  console.log('[2/4] Lade Strava-Aktivitaeten...')
  const allActivities = await fetchAllStravaActivities()
  console.log(`  → ${allActivities.length} Aktivitaeten insgesamt geladen\n`)

  // Filtern: Nur relevante Typen mit Hoehengewinn
  const relevantActivities = allActivities.filter(a => {
    const typeMatch = ALLOWED_TYPES.has(a.type) || ALLOWED_TYPES.has(a.sport_type)
    const hasElevation = (a.total_elevation_gain || 0) > 0
    return typeMatch && hasElevation
  })

  console.log(`  → ${relevantActivities.length} relevante Aktivitaeten (Hike/Run/Walk/Trail Run/Ski mit Hoehengewinn)\n`)

  // Schritt 3: GPS-Streams verarbeiten und Gipfel erkennen
  console.log('[3/4] Verarbeite Aktivitaeten und erkenne Gipfel...')
  console.log('  (Pause von ' + (STREAM_DELAY_MS / 1000) + 's zwischen Requests wegen Strava Rate-Limit)\n')

  let processedCount = 0
  let summitCount = 0
  let errorCount = 0
  const allFoundSummits = [] // Fuer die Zusammenfassung

  for (let idx = 0; idx < relevantActivities.length; idx++) {
    const activity = relevantActivities[idx]
    const activityDate = new Date(activity.start_date)
    const dateStr = activityDate.toISOString().split('T')[0]

    console.log(`  [${idx + 1}/${relevantActivities.length}] ${dateStr} — ${activity.name} (${activity.type}, ${activity.total_elevation_gain}m Aufstieg)`)

    try {
      // GPS-Stream holen
      const streams = await fetchStravaStream(activity.id)

      if (!streams) {
        console.log('    → Keine GPS-Daten vorhanden, uebersprungen')
        processedCount++
        // Pause zwischen Requests einhalten
        if (idx < relevantActivities.length - 1) await sleep(STREAM_DELAY_MS)
        continue
      }

      const latlngStream = streams.find(s => s.type === 'latlng')
      const timeStream = streams.find(s => s.type === 'time')

      if (!latlngStream || !latlngStream.data || latlngStream.data.length === 0) {
        console.log('    → Kein latlng-Stream vorhanden, uebersprungen')
        processedCount++
        if (idx < relevantActivities.length - 1) await sleep(STREAM_DELAY_MS)
        continue
      }

      console.log(`    → ${latlngStream.data.length} GPS-Punkte geladen`)

      // Gipfel im Stream suchen
      const foundPeaks = findPeaksInStream(
        latlngStream.data,
        timeStream?.data || null,
        peaks,
        activityDate
      )

      if (foundPeaks.size === 0) {
        console.log('    → Keine Gipfel erkannt')
      } else {
        console.log(`    → ${foundPeaks.size} Gipfel erkannt:`)

        // Schritt 4: Summits in Supabase speichern
        const season = getSeason(activityDate)

        for (const [peakId, data] of foundPeaks) {
          const { peak, timeOffset, distance } = data

          // Gipfel-Zeitpunkt berechnen
          const summitTime = new Date(activityDate.getTime() + (timeOffset * 1000))

          // Erst-Besuch pruefen (vor dem Upsert, damit die Reihenfolge stimmt)
          const isPersonalFirst = await checkPersonalFirst(peakId)
          const isSeasonFirst = await checkSeasonFirst(peakId, season)

          // Punkte berechnen
          const points = calculatePoints(
            peak.elevation,
            isSeasonFirst,
            isPersonalFirst,
            peak.osm_region
          )

          const multiplierInfo = isSeasonFirst ? 'Saison-Erst x3' :
                                 isPersonalFirst ? 'Persoenlich-Erst x1.5' :
                                 'Wiederholung x0.2'

          console.log(`      * ${peak.name} (${peak.elevation || '?'}m) — ${distance}m Distanz — ${points} Pkt. (${multiplierInfo})`)

          // In Supabase speichern
          const success = await upsertSummit({
            user_id: SUPABASE_USER_ID,
            peak_id: peakId,
            summited_at: summitTime.toISOString(),
            season,
            strava_activity_id: activity.id.toString(),
            checkin_method: 'strava',
            points,
            is_season_first: isSeasonFirst,
            is_personal_first: isPersonalFirst,
            safety_ok: true
          })

          if (success) {
            summitCount++
            allFoundSummits.push({
              peakName: peak.name,
              elevation: peak.elevation,
              date: dateStr,
              activityName: activity.name,
              points,
              isSeasonFirst,
              isPersonalFirst
            })
          } else {
            errorCount++
          }
        }
      }

      processedCount++
    } catch (err) {
      console.error(`    → FEHLER: ${err.message}`)
      errorCount++
      processedCount++
    }

    // Pause zwischen Stream-Requests (Rate-Limit Schutz)
    if (idx < relevantActivities.length - 1) {
      await sleep(STREAM_DELAY_MS)
    }
  }

  // ============================================================
  // Zusammenfassung
  // ============================================================

  console.log('\n================================================================')
  console.log('  Import abgeschlossen — Zusammenfassung')
  console.log('================================================================')
  console.log(`  Aktivitaeten gesamt:     ${allActivities.length}`)
  console.log(`  Davon relevant:          ${relevantActivities.length}`)
  console.log(`  Verarbeitet:             ${processedCount}`)
  console.log(`  Gipfel gefunden:         ${summitCount}`)
  if (errorCount > 0) {
    console.log(`  Fehler:                  ${errorCount}`)
  }
  console.log('')

  if (allFoundSummits.length > 0) {
    console.log('  Gefundene Gipfel:')
    console.log('  ─────────────────────────────────────────────────')

    // Nach Datum sortieren
    allFoundSummits.sort((a, b) => a.date.localeCompare(b.date))

    for (const s of allFoundSummits) {
      const flags = []
      if (s.isSeasonFirst) flags.push('SAISON-ERST')
      if (s.isPersonalFirst) flags.push('PERSOENLICH-ERST')
      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
      console.log(`    ${s.date}  ${s.peakName} (${s.elevation || '?'}m) — ${s.points} Pkt.${flagStr}`)
      console.log(`             via: ${s.activityName}`)
    }

    // Gesamtpunkte berechnen
    const totalPoints = allFoundSummits.reduce((sum, s) => sum + s.points, 0)
    console.log('')
    console.log(`  Gesamtpunkte:  ${totalPoints}`)

    // Einzigartige Gipfel zaehlen
    const uniquePeaks = new Set(allFoundSummits.map(s => s.peakName))
    console.log(`  Einzigartige Gipfel:  ${uniquePeaks.size}`)
    console.log('')
    console.log('  Gipfel-Liste (einzigartig):')
    for (const name of [...uniquePeaks].sort()) {
      console.log(`    - ${name}`)
    }
  } else {
    console.log('  Keine Gipfel gefunden.')
  }

  console.log('\n================================================================\n')
}

// Skript starten
main().catch(err => {
  console.error('Fataler Fehler:', err)
  process.exit(1)
})
