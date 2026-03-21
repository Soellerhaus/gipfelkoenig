// Gipfelkönig — Bulk-Import aller Strava-Aktivitäten eines Users
// Holt alle passenden Aktivitäten, analysiert GPS-Tracks gegen Gipfel-DB,
// berechnet Punkte und speichert Summits. Rate-limited für Strava API.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS-Header für Browser-Zugriff
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Erlaubte Aktivitätstypen (nur Bergaktivitäten mit relevantem Höhengewinn)
const ALLOWED_TYPES = ['Hike', 'Run', 'Walk', 'TrailRun', 'AlpineSki']
const MIN_ELEVATION_GAIN = 100
const STRAVA_PAGE_SIZE = 50
const PEAK_RADIUS_METERS = 80
const STREAM_DELAY_MS = 2000

// Haversine-Distanz in Metern
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Punkte-Berechnung (Kernformel aus CLAUDE.md)
function calculatePoints(
  elevation: number,
  isSeasonFirst: boolean,
  isPersonalFirst: boolean,
  isRepeat: boolean,
  osmRegion: string
): number {
  let points = elevation || 1000

  // Multiplikatoren: season_first > personal_first > repeat
  if (isSeasonFirst) {
    points *= 3
  } else if (isPersonalFirst) {
    points *= 1.5
  } else if (isRepeat) {
    points *= 0.2
  }

  // AT-08 Heimat-Bonus
  if (osmRegion === 'AT-08') {
    points += 100
  }

  return Math.round(points)
}

// Saison aus Datum berechnen (= Jahreszahl)
function getSeason(date: Date): string {
  return date.getFullYear().toString()
}

// Verzögerung für Rate-Limiting
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Alle Gipfel aus der DB laden (paginiert, handhabt >1000 Zeilen)
async function loadAllPeaks(supabase: any): Promise<any[]> {
  const allPeaks: any[] = []
  const PAGE_SIZE = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('peaks')
      .select('id, name, lat, lng, elevation, osm_region, season_from, season_to')
      .eq('is_active', true)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error(`Fehler beim Laden der Gipfel (Offset ${offset}):`, error)
      throw new Error(`Gipfel-Laden fehlgeschlagen: ${error.message}`)
    }

    if (!data || data.length === 0) break

    allPeaks.push(...data)
    console.log(`${allPeaks.length} Gipfel geladen...`)

    // Weniger als PAGE_SIZE Ergebnisse → letzte Seite
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  console.log(`Gesamt: ${allPeaks.length} aktive Gipfel geladen`)
  return allPeaks
}

// Alle Strava-Aktivitäten paginiert abrufen (nur relevante Typen)
async function fetchAllStravaActivities(stravaToken: string): Promise<any[]> {
  const allActivities: any[] = []
  let page = 1

  while (true) {
    const url = `https://www.strava.com/api/v3/athlete/activities?per_page=${STRAVA_PAGE_SIZE}&page=${page}`
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${stravaToken}` }
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error(`Strava Activities Fehler (Seite ${page}): ${res.status} - ${errorText}`)
      throw new Error(`Strava API Fehler: ${res.status}`)
    }

    const activities = await res.json()

    if (!activities || activities.length === 0) break

    // Nur relevante Aktivitäten filtern
    const filtered = activities.filter((a: any) =>
      ALLOWED_TYPES.includes(a.type) &&
      (a.total_elevation_gain || 0) > MIN_ELEVATION_GAIN
    )

    allActivities.push(...filtered)
    console.log(`Seite ${page}: ${activities.length} Aktivitäten geladen, ${filtered.length} relevant (Gesamt: ${allActivities.length})`)

    // Weniger als STRAVA_PAGE_SIZE → letzte Seite
    if (activities.length < STRAVA_PAGE_SIZE) break
    page++
  }

  console.log(`Gesamt: ${allActivities.length} relevante Aktivitäten gefunden`)
  return allActivities
}

// GPS-Streams einer Aktivität von Strava holen
async function fetchActivityStreams(activityId: string, stravaToken: string): Promise<any | null> {
  const url = `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=latlng,time&key_type=stream`
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${stravaToken}` }
  })

  if (!res.ok) {
    // 404 = keine GPS-Daten, kein harter Fehler
    if (res.status === 404) {
      console.log(`Aktivität ${activityId}: Keine Streams verfügbar`)
      return null
    }
    // 429 = Rate Limit → abbrechen
    if (res.status === 429) {
      console.error(`Strava Rate Limit erreicht bei Aktivität ${activityId}`)
      throw new Error('Strava Rate Limit erreicht. Bitte später erneut versuchen.')
    }
    console.error(`Strava Streams Fehler (${activityId}): ${res.status}`)
    return null
  }

  const streams = await res.json()
  const latlngStream = streams.find((s: any) => s.type === 'latlng')
  const timeStream = streams.find((s: any) => s.type === 'time')

  if (!latlngStream?.data?.length) {
    console.log(`Aktivität ${activityId}: Leere GPS-Daten`)
    return null
  }

  return { latlng: latlngStream.data, time: timeStream?.data || [] }
}

// GPS-Punkte gegen Gipfel-Liste prüfen (Haversine, 80m Radius)
function findPeaksInTrack(
  gpsPoints: [number, number][],
  timeOffsets: number[],
  peaks: any[]
): Map<number, { peak: any, timeOffset: number }> {
  const foundPeaks = new Map<number, { peak: any, timeOffset: number }>()

  // Jeden 5. Punkt prüfen (Balance zwischen Genauigkeit und Performance)
  for (let i = 0; i < gpsPoints.length; i += 5) {
    const [lat, lng] = gpsPoints[i]
    const timeOffset = timeOffsets[i] || 0

    // Vorab-Filter: Nur Gipfel im groben Bereich prüfen (~111m pro 0.001°)
    for (const peak of peaks) {
      if (foundPeaks.has(peak.id)) continue

      // Schneller Vorfilter (Bounding Box)
      if (Math.abs(peak.lat - lat) > 0.001 || Math.abs(peak.lng - lng) > 0.001) continue

      // Exakte Haversine-Prüfung
      const dist = haversineDistance(lat, lng, peak.lat, peak.lng)
      if (dist <= PEAK_RADIUS_METERS) {
        foundPeaks.set(peak.id, { peak, timeOffset })
      }
    }
  }

  return foundPeaks
}

serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const { user_id, strava_token } = await req.json()

    if (!user_id || !strava_token) {
      return new Response(JSON.stringify({ error: 'user_id und strava_token sind erforderlich' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`=== Import gestartet für User ${user_id} ===`)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Alle Gipfel aus der DB laden (paginiert)
    console.log('Lade alle Gipfel aus der Datenbank...')
    const peaks = await loadAllPeaks(supabase)

    if (peaks.length === 0) {
      return new Response(JSON.stringify({ error: 'Keine Gipfel in der Datenbank gefunden' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 2. Alle relevanten Strava-Aktivitäten holen
    console.log('Lade Strava-Aktivitäten...')
    const activities = await fetchAllStravaActivities(strava_token)

    if (activities.length === 0) {
      return new Response(JSON.stringify({
        activities_processed: 0,
        summits_found: 0,
        total_points: 0,
        message: 'Keine relevanten Aktivitäten gefunden'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 3. Bereits importierte Aktivitäten ermitteln (Duplikat-Vermeidung)
    const { data: existingSummits } = await supabase
      .from('summits')
      .select('strava_activity_id')
      .eq('user_id', user_id)
      .eq('checkin_method', 'strava')
      .not('strava_activity_id', 'is', null)

    const importedActivityIds = new Set(
      (existingSummits || []).map((s: any) => s.strava_activity_id)
    )

    // Nur noch nicht importierte Aktivitäten verarbeiten
    const newActivities = activities.filter(
      (a: any) => !importedActivityIds.has(a.id.toString())
    )

    console.log(`${newActivities.length} neue Aktivitäten zu verarbeiten (${importedActivityIds.size} bereits importiert)`)

    let activitiesProcessed = 0
    let summitsFound = 0
    let totalNewPoints = 0
    const errors: string[] = []

    // 4. Jede Aktivität verarbeiten
    for (const activity of newActivities) {
      try {
        const activityId = activity.id.toString()
        const activityStart = new Date(activity.start_date)
        const season = getSeason(activityStart)

        console.log(`Verarbeite: "${activity.name}" (${activityId}) vom ${activity.start_date}`)

        // Rate-Limiting: 2 Sekunden Pause zwischen Stream-Requests
        if (activitiesProcessed > 0) {
          await delay(STREAM_DELAY_MS)
        }

        // GPS-Streams holen
        const streams = await fetchActivityStreams(activityId, strava_token)
        if (!streams) {
          console.log(`Überspringe ${activityId}: Keine GPS-Daten`)
          activitiesProcessed++
          continue
        }

        // GPS-Track gegen Gipfel prüfen
        const foundPeaks = findPeaksInTrack(streams.latlng, streams.time, peaks)

        if (foundPeaks.size === 0) {
          activitiesProcessed++
          continue
        }

        console.log(`${foundPeaks.size} Gipfel in Aktivität "${activity.name}" gefunden`)

        // 5. Jeden gefundenen Gipfel verarbeiten
        for (const [peakId, { peak, timeOffset }] of foundPeaks) {
          // Gipfel-Zeitpunkt berechnen
          const summitTime = new Date(activityStart.getTime() + (timeOffset * 1000))
          const summitDate = summitTime.toISOString().split('T')[0]

          // Saison-Check: Liegt Datum in der Gipfel-Saison?
          const month = summitTime.getMonth() + 1
          const day = summitTime.getDate()
          const monthDay = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`

          if (monthDay < peak.season_from || monthDay > peak.season_to) {
            console.log(`${peak.name}: Außerhalb der Saison (${monthDay}, erlaubt ${peak.season_from}–${peak.season_to})`)
            continue
          }

          // Duplikat-Check: Gleicher User + Gipfel + Aktivität schon vorhanden?
          const { count: dupCount } = await supabase
            .from('summits')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user_id)
            .eq('peak_id', peakId)
            .eq('strava_activity_id', activityId)

          if ((dupCount || 0) > 0) {
            console.log(`${peak.name}: Bereits für Aktivität ${activityId} gespeichert`)
            continue
          }

          // SICHERHEITS-CHECK (KRITISCH: Stufe >= 3 → KEINE Punkte)
          const { data: safety } = await supabase
            .from('safety_status')
            .select('danger_level, is_safe')
            .eq('region_id', peak.osm_region)
            .eq('date', summitDate)
            .single()

          const safetyLevel = safety?.danger_level || 0
          const isSafe = safety ? safety.is_safe : true // Kein Eintrag = sicher (Sommer)

          if (!isSafe) {
            console.log(`${peak.name}: Gesperrt am ${summitDate} (Gefahrenstufe ${safetyLevel})`)
            // Summit ohne Punkte speichern (zur Dokumentation)
            await supabase.from('summits').insert({
              user_id,
              peak_id: peakId,
              summited_at: summitTime.toISOString(),
              season,
              strava_activity_id: activityId,
              checkin_method: 'strava',
              points: 0,
              is_season_first: false,
              is_personal_first: false,
              safety_ok: false,
              safety_level: safetyLevel
            })
            summitsFound++
            continue
          }

          // Prüfe: Erster Besuch diese Saison (aller User)?
          const { count: seasonCount } = await supabase
            .from('summits')
            .select('*', { count: 'exact', head: true })
            .eq('peak_id', peakId)
            .eq('season', season)
            .eq('safety_ok', true)

          const isSeasonFirst = (seasonCount || 0) === 0

          // Prüfe: Erster Besuch dieses Users auf diesem Gipfel (alle Saisons)?
          const { count: personalCount } = await supabase
            .from('summits')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user_id)
            .eq('peak_id', peakId)
            .eq('safety_ok', true)

          const isPersonalFirst = (personalCount || 0) === 0

          // Wiederholung = weder season_first noch personal_first
          const isRepeat = !isSeasonFirst && !isPersonalFirst

          // Punkte berechnen
          const points = calculatePoints(
            peak.elevation,
            isSeasonFirst,
            isPersonalFirst,
            isRepeat,
            peak.osm_region
          )

          // Summit speichern
          const { error: insertError } = await supabase.from('summits').insert({
            user_id,
            peak_id: peakId,
            summited_at: summitTime.toISOString(),
            season,
            strava_activity_id: activityId,
            checkin_method: 'strava',
            points,
            is_season_first: isSeasonFirst,
            is_personal_first: isPersonalFirst,
            safety_ok: true,
            safety_level: safetyLevel
          })

          if (insertError) {
            console.error(`Fehler beim Speichern von ${peak.name}:`, insertError)
            errors.push(`${peak.name}: ${insertError.message}`)
            continue
          }

          totalNewPoints += points
          summitsFound++
          console.log(`✓ ${peak.name} (${peak.elevation}m) — ${points} Punkte (Season-First: ${isSeasonFirst}, Personal-First: ${isPersonalFirst})`)
        }

        activitiesProcessed++

      } catch (activityError) {
        const msg = activityError instanceof Error ? activityError.message : String(activityError)
        console.error(`Fehler bei Aktivität ${activity.id}:`, msg)
        errors.push(`Aktivität ${activity.id}: ${msg}`)

        // Bei Rate-Limit sofort abbrechen
        if (msg.includes('Rate Limit')) {
          break
        }

        activitiesProcessed++
      }
    }

    // 6. Gesamtpunkte des Users neu berechnen (Summe aller Summits)
    if (totalNewPoints > 0) {
      const { data: pointsSum } = await supabase
        .from('summits')
        .select('points')
        .eq('user_id', user_id)
        .eq('safety_ok', true)

      const recalculatedTotal = (pointsSum || []).reduce(
        (sum: number, s: any) => sum + (s.points || 0), 0
      )

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ total_points: recalculatedTotal })
        .eq('id', user_id)

      if (updateError) {
        console.error('Fehler beim Aktualisieren der Gesamtpunkte:', updateError)
        errors.push(`Punkte-Update: ${updateError.message}`)
      } else {
        console.log(`Gesamtpunkte aktualisiert: ${recalculatedTotal}`)
      }
    }

    // Zusammenfassung
    const summary = {
      activities_processed: activitiesProcessed,
      summits_found: summitsFound,
      total_points: totalNewPoints,
      skipped_already_imported: importedActivityIds.size,
      ...(errors.length > 0 && { errors })
    }

    console.log(`=== Import abgeschlossen ===`, JSON.stringify(summary))

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('import-activities Fehler:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
