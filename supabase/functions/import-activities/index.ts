// Gipfelkönig — Seitenweiser Import von Strava-Aktivitäten
// Verarbeitet eine Seite pro Request (keine Timeouts!)
// Browser ruft wiederholt auf: page=1, page=2, ... bis done=true

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Skitouren (BackcountrySki) zählen, Pistenskifahren (AlpineSki) NICHT
// Wandern, Schneeschuh, Skitour, Trailrunning, Langlauf — NICHT Skifahren/Radfahren
const ALLOWED_TYPES = ['Hike', 'Run', 'Walk', 'TrailRun', 'BackcountrySki', 'Snowshoe', 'NordicSki']
const MIN_ELEVATION_GAIN = 50
const STRAVA_PAGE_SIZE = 30
const PEAK_RADIUS_METERS = 80

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

// Punkte-Berechnung: 1 Punkt pro 100 HM, Pässe/Hütten/Scharten = 2 Punkte fix
function calculatePoints(elevation: number, isSeasonFirst: boolean, isPersonalFirst: boolean, osmRegion: string, difficulty?: string): number {
  // Pässe, Hütten, Scharten: feste 2 Punkte
  if (difficulty === 'pass' || difficulty === 'hut' || difficulty === 'saddle') {
    let points = 2
    if (isSeasonFirst) points *= 3
    else if (isPersonalFirst) points *= 1.5
    else points *= 0.2
    return Math.round(points)
  }
  // Gipfel: 1 Punkt pro 100 HM
  let points = Math.round((elevation || 1000) / 100)
  if (isSeasonFirst) points *= 3
  else if (isPersonalFirst) points *= 1.5
  else points *= 0.2
  if (osmRegion === 'AT-08') points += 1
  return Math.round(points)
}

function getSeason(date: Date): string {
  return date.getFullYear().toString()
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// GPS-Punkte gegen Gipfel prüfen
function findPeaksInTrack(gpsPoints: [number, number][], timeOffsets: number[], peaks: any[]): Map<number, { peak: any, timeOffset: number }> {
  const found = new Map<number, { peak: any, timeOffset: number }>()
  for (let i = 0; i < gpsPoints.length; i += 3) {
    const [lat, lng] = gpsPoints[i]
    const timeOffset = timeOffsets[i] || 0
    for (const peak of peaks) {
      if (found.has(peak.id)) continue
      if (Math.abs(peak.lat - lat) > 0.001 || Math.abs(peak.lng - lng) > 0.001) continue
      if (haversineDistance(lat, lng, peak.lat, peak.lng) <= PEAK_RADIUS_METERS) {
        found.set(peak.id, { peak, timeOffset })
      }
    }
  }
  return found
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const { user_id, strava_token, page = 1 } = await req.json()

    if (!user_id || !strava_token) {
      return new Response(JSON.stringify({ error: 'user_id und strava_token erforderlich' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`=== Import Seite ${page} für User ${user_id} ===`)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Token-Refresh: Prüfe ob Token abgelaufen und erneuere automatisch
    let activeToken = strava_token
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('strava_token, strava_refresh_token, strava_token_expires_at')
      .eq('id', user_id)
      .single()

    if (profile?.strava_token_expires_at) {
      const expiresAt = new Date(profile.strava_token_expires_at).getTime()
      if (Date.now() > expiresAt - 300000) { // 5 Min vor Ablauf refreshen
        console.log('Token abgelaufen — refreshe...')
        const refreshResp = await fetch('https://www.strava.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: Deno.env.get('STRAVA_CLIENT_ID'),
            client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
            grant_type: 'refresh_token',
            refresh_token: profile.strava_refresh_token
          })
        })
        const refreshData = await refreshResp.json()
        if (refreshData.access_token) {
          activeToken = refreshData.access_token
          await supabase.from('user_profiles').update({
            strava_token: refreshData.access_token,
            strava_refresh_token: refreshData.refresh_token || profile.strava_refresh_token,
            strava_token_expires_at: new Date(refreshData.expires_at * 1000).toISOString()
          }).eq('id', user_id)
          console.log('Token erfolgreich refresht!')
        } else {
          console.error('Token-Refresh fehlgeschlagen:', refreshData)
          return new Response(JSON.stringify({ error: 'Token-Refresh fehlgeschlagen', done: true }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
      }
    }

    // 1. Gipfel werden pro Aktivität geladen (nur nahe Gipfel, spart Speicher)
    console.log('Gipfel werden pro Aktivität geladen (Bounding Box)')

    // 2. Eine Seite Strava-Aktivitäten holen
    const url = `https://www.strava.com/api/v3/athlete/activities?per_page=${STRAVA_PAGE_SIZE}&page=${page}`
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${activeToken}` }
    })

    if (!res.ok) {
      throw new Error(`Strava API Fehler: ${res.status}`)
    }

    const activities = await res.json()
    const relevant = activities.filter((a: any) =>
      ALLOWED_TYPES.includes(a.type) && (a.total_elevation_gain || 0) > MIN_ELEVATION_GAIN
    )

    console.log(`Seite ${page}: ${activities.length} Aktivitäten, ${relevant.length} relevant`)

    // Keine Aktivitäten mehr → Import fertig
    if (activities.length === 0) {
      // Gesamtpunkte neu berechnen
      const { data: allSummits } = await supabase
        .from('summits')
        .select('points')
        .eq('user_id', user_id)
        .eq('safety_ok', true)
      const total = (allSummits || []).reduce((s: number, r: any) => s + (r.points || 0), 0)
      await supabase.from('user_profiles').update({
        total_points: total,
        import_status: 'done',
        import_progress: 100,
        import_message: `Import abgeschlossen · ${total} Punkte`
      }).eq('id', user_id)

      return new Response(JSON.stringify({
        done: true, page, summits_found: 0, total_points: total
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 3. Bereits importierte IDs holen
    const { data: existing } = await supabase
      .from('summits')
      .select('strava_activity_id')
      .eq('user_id', user_id)
      .eq('checkin_method', 'strava')
      .not('strava_activity_id', 'is', null)
    const importedIds = new Set((existing || []).map((s: any) => s.strava_activity_id))

    let summitsFound = 0
    let pagePoints = 0
    const peakNames: string[] = []

    // 4. Jede relevante Aktivität verarbeiten
    for (const activity of relevant) {
      const activityId = activity.id.toString()
      if (importedIds.has(activityId)) continue

      try {
        // Nahe Gipfel laden basierend auf Start-Koordinaten der Aktivität
        const startLat = activity.start_latlng?.[0]
        const startLng = activity.start_latlng?.[1]
        if (!startLat || !startLng) continue

        // Gipfel im Umkreis von ~30km laden (0.3 Grad)
        const { data: nearbyPeaks } = await supabase
          .from('peaks')
          .select('id, name, lat, lng, elevation, osm_region, season_from, season_to, difficulty')
          .eq('is_active', true)
          .gte('lat', startLat - 0.3)
          .lte('lat', startLat + 0.3)
          .gte('lng', startLng - 0.3)
          .lte('lng', startLng + 0.3)

        if (!nearbyPeaks || nearbyPeaks.length === 0) {
          // Keine Gipfel in der Nähe — Aktivität trotzdem speichern für HM/km
          await supabase.from('summits').insert({
            user_id, peak_id: null,
            summited_at: new Date(activity.start_date).toISOString(),
            season: getSeason(new Date(activity.start_date)),
            strava_activity_id: activityId,
            checkin_method: 'strava', points: 0,
            is_season_first: false, is_personal_first: false,
            safety_ok: true, safety_level: 0,
            elevation_gain: activity.total_elevation_gain ? Math.round(activity.total_elevation_gain) : null,
            distance: activity.distance ? Math.round(activity.distance / 1000) : null
          }).catch(() => {})
          continue
        }

        // GPS-Streams holen
        await delay(1500) // Rate Limiting
        const streamUrl = `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=latlng,time&key_type=stream`
        const streamRes = await fetch(streamUrl, {
          headers: { 'Authorization': `Bearer ${activeToken}` }
        })

        if (!streamRes.ok) {
          if (streamRes.status === 429) break // Rate Limit
          continue
        }

        const streams = await streamRes.json()
        const latlng = streams.find((s: any) => s.type === 'latlng')?.data
        const time = streams.find((s: any) => s.type === 'time')?.data || []
        if (!latlng?.length) continue

        // Gipfel suchen (nur nahe Gipfel, nicht 42k!)
        const found = findPeaksInTrack(latlng, time, nearbyPeaks)

        const activityStart = new Date(activity.start_date)
        const season = getSeason(activityStart)

        // Aktivität IMMER speichern (auch ohne Gipfelmatch → HM/km werden gezählt)
        if (found.size === 0) {
          await supabase.from('summits').insert({
            user_id, peak_id: null,
            summited_at: activityStart.toISOString(),
            season, strava_activity_id: activityId,
            checkin_method: 'strava', points: 0,
            is_season_first: false, is_personal_first: false,
            safety_ok: true, safety_level: 0,
            elevation_gain: activity.total_elevation_gain ? Math.round(activity.total_elevation_gain) : null,
            distance: activity.distance ? Math.round(activity.distance / 1000) : null
          }).then(() => console.log(`🏃 Aktivität ${activityId} gespeichert (kein Gipfel, ${Math.round(activity.total_elevation_gain||0)} HM)`))
            .catch(() => {})
          continue
        }

        for (const [peakId, { peak, timeOffset }] of found) {
          const summitTime = new Date(activityStart.getTime() + (timeOffset * 1000))

          // Saison-Check
          const mm = (summitTime.getMonth() + 1).toString().padStart(2, '0')
          const dd = summitTime.getDate().toString().padStart(2, '0')
          const monthDay = `${mm}-${dd}`
          if (monthDay < peak.season_from || monthDay > peak.season_to) continue

          // Duplikat-Check
          const { count } = await supabase
            .from('summits').select('*', { count: 'exact', head: true })
            .eq('user_id', user_id).eq('peak_id', peakId).eq('strava_activity_id', activityId)
          if ((count || 0) > 0) continue

          // Season-First + Personal-First prüfen
          const { count: sc } = await supabase
            .from('summits').select('*', { count: 'exact', head: true })
            .eq('peak_id', peakId).eq('season', season).eq('safety_ok', true)
          const { count: pc } = await supabase
            .from('summits').select('*', { count: 'exact', head: true })
            .eq('user_id', user_id).eq('peak_id', peakId).eq('safety_ok', true)

          const isSeasonFirst = (sc || 0) === 0
          const isPersonalFirst = (pc || 0) === 0
          const points = calculatePoints(peak.elevation, isSeasonFirst, isPersonalFirst, peak.osm_region, peak.difficulty)

          await supabase.from('summits').insert({
            user_id, peak_id: peakId,
            summited_at: summitTime.toISOString(),
            season, strava_activity_id: activityId,
            checkin_method: 'strava', points,
            is_season_first: isSeasonFirst,
            is_personal_first: isPersonalFirst,
            safety_ok: true, safety_level: 0,
            elevation_gain: activity.total_elevation_gain ? Math.round(activity.total_elevation_gain) : null,
            distance: activity.distance ? Math.round(activity.distance / 1000) : null
          })

          summitsFound++
          pagePoints += points
          peakNames.push(`${peak.name} (${peak.elevation}m)`)
          console.log(`⛰️ ${peak.name} — ${points} Pkt`)
        }
      } catch (e) {
        console.error(`Fehler Aktivität ${activityId}:`, e)
      }
    }

    // Fortschritt updaten
    const hasMore = activities.length >= STRAVA_PAGE_SIZE
    if (!hasMore) {
      // Letzte Seite → Gesamtpunkte berechnen
      const { data: allSummits } = await supabase
        .from('summits').select('points')
        .eq('user_id', user_id).eq('safety_ok', true)
      const total = (allSummits || []).reduce((s: number, r: any) => s + (r.points || 0), 0)
      await supabase.from('user_profiles').update({
        total_points: total, import_status: 'done',
        import_progress: 100, import_message: `Import abgeschlossen · ${total} Punkte`
      }).eq('id', user_id)
    } else {
      await supabase.from('user_profiles').update({
        import_status: 'importing',
        import_progress: Math.min(95, page * 10),
        import_message: `Seite ${page} · ${summitsFound} Gipfel`
      }).eq('id', user_id)
    }

    return new Response(JSON.stringify({
      done: !hasMore,
      page,
      activities_on_page: activities.length,
      relevant: relevant.length,
      summits_found: summitsFound,
      points: pagePoints,
      peaks: peakNames,
      has_more: hasMore
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Import Fehler:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
