// Gipfelkönig — Suunto Webhook
// Empfängt Workout-Benachrichtigungen von Suunto, lädt FIT-Datei,
// parsed GPS-Koordinaten, prüft Gipfelnähe (80m) und erstellt Einträge

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUBSCRIPTION_KEY = 'b19a9773d9574f83a4e9d950c3ec9d5b'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const payload = await req.json()
    console.log('Suunto webhook received:', JSON.stringify(payload))

    // Suunto sendet: { username, workoutid, ... }
    const workoutId = payload.workoutid || payload.workoutId
    const suuntoUserId = payload.username || payload.userId

    if (!workoutId || !suuntoUserId) {
      return new Response(JSON.stringify({ error: 'Missing workoutId or userId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Unseren User via suunto_user_id finden
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, suunto_token')
      .eq('suunto_user_id', suuntoUserId)
      .single()

    if (!profile || !profile.suunto_token) {
      console.log('Kein User gefunden für Suunto ID:', suuntoUserId)
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Workout-Details von Suunto API holen
    const workoutRes = await fetch(`https://cloudapi.suunto.com/v2/workouts/${workoutId}`, {
      headers: {
        'Authorization': `Bearer ${profile.suunto_token}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY
      }
    })
    const workout = await workoutRes.json()

    // FIT-Datei holen (enthält GPS-Daten)
    const fitRes = await fetch(`https://cloudapi.suunto.com/v2/workouts/${workoutId}/exportFit`, {
      headers: {
        'Authorization': `Bearer ${profile.suunto_token}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY
      }
    })

    if (!fitRes.ok) {
      console.log('FIT-Datei konnte nicht geladen werden:', fitRes.status)
      return new Response(JSON.stringify({ status: 'no_fit_file' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const fitBuffer = await fitRes.arrayBuffer()

    // FIT-Datei nach GPS-Koordinaten parsen
    const gpsPoints = parseFitGps(new Uint8Array(fitBuffer))

    if (gpsPoints.length === 0) {
      console.log('Keine GPS-Punkte in FIT-Datei gefunden')
      return new Response(JSON.stringify({ status: 'no_gps_data' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Höhenmeter und Distanz berechnen
    let totalElevGain = 0
    let totalDist = 0
    for (let i = 1; i < gpsPoints.length; i++) {
      const elevDiff = (gpsPoints[i].elevation || 0) - (gpsPoints[i - 1].elevation || 0)
      if (elevDiff > 0) totalElevGain += elevDiff

      // Haversine-Distanz
      const dLat = (gpsPoints[i].lat - gpsPoints[i - 1].lat) * Math.PI / 180
      const dLng = (gpsPoints[i].lng - gpsPoints[i - 1].lng) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(gpsPoints[i - 1].lat * Math.PI / 180) *
        Math.cos(gpsPoints[i].lat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2
      totalDist += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }
    const totalDistKm = Math.round(totalDist / 100) / 10

    // GPS-Punkte gegen Gipfel-Datenbank prüfen (80m Radius)
    const foundPeaks = new Map<string, { peak: any; point: any }>()
    for (const pt of gpsPoints) {
      const { data: nearbyPeaks } = await supabase
        .from('peaks')
        .select('id, name, elevation, lat, lng')
        .gte('lat', pt.lat - 0.001)
        .lte('lat', pt.lat + 0.001)
        .gte('lng', pt.lng - 0.001)
        .lte('lng', pt.lng + 0.001)
        .limit(5)

      if (nearbyPeaks) {
        for (const peak of nearbyPeaks) {
          const dist = haversine(pt.lat, pt.lng, peak.lat, peak.lng)
          if (dist <= 80 && !foundPeaks.has(peak.id)) {
            foundPeaks.set(peak.id, { peak, point: pt })
          }
        }
      }
    }

    console.log(`${foundPeaks.size} Gipfel in Suunto Workout ${workoutId} gefunden`)

    // Besteigungen speichern
    const startTime = workout.startTime || gpsPoints[0]?.time || new Date().toISOString()
    const season = new Date(startTime).getFullYear().toString()
    const startHour = new Date(startTime).getHours()

    for (const [peakId, { peak, point }] of foundPeaks) {
      // Punkte berechnen
      const basePts = Math.round(totalElevGain / 100) + Math.round(totalDistKm) + 10

      // Saison-Erster / Persönlich-Erster prüfen
      const { data: existingSeason } = await supabase
        .from('summits')
        .select('id')
        .eq('peak_id', peakId)
        .eq('season', season)
        .limit(1)

      const { data: existingPersonal } = await supabase
        .from('summits')
        .select('id')
        .eq('peak_id', peakId)
        .eq('user_id', profile.id)
        .limit(1)

      const isSeasonFirst = !existingSeason || existingSeason.length === 0
      const isPersonalFirst = !existingPersonal || existingPersonal.length === 0

      let pts = basePts
      if (isSeasonFirst) pts = Math.round(basePts * 3)
      else if (isPersonalFirst) pts = Math.round(basePts * 2)
      else pts = Math.round(basePts * 0.2)

      // Frühaufsteher-Bonus
      if (startHour < 7) pts += 15

      await supabase.from('summits').insert({
        user_id: profile.id,
        peak_id: peakId,
        summited_at: point.time || startTime,
        season,
        checkin_method: 'suunto',
        points: pts,
        elevation_gain: Math.round(totalElevGain),
        distance: totalDistKm,
        safety_ok: true,
        safety_level: 0,
        is_season_first: isSeasonFirst,
        is_personal_first: isPersonalFirst
      })
    }

    // total_points aktualisieren
    const { data: allSummits } = await supabase
      .from('summits')
      .select('points')
      .eq('user_id', profile.id)

    const totalPoints = (allSummits || []).reduce((sum: number, s: any) => sum + (s.points || 0), 0)
    await supabase.from('user_profiles').update({ total_points: totalPoints }).eq('id', profile.id)

    return new Response(JSON.stringify({
      success: true,
      peaks_found: foundPeaks.size,
      total_elev_gain: Math.round(totalElevGain),
      total_dist_km: totalDistKm
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Suunto webhook Fehler:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Einfacher FIT GPS-Parser (extrahiert lat/lng/elevation/time aus Record Messages)
function parseFitGps(data: Uint8Array): Array<{ lat: number; lng: number; elevation?: number; time?: string }> {
  const points: Array<{ lat: number; lng: number; elevation?: number; time?: string }> = []

  // FIT-Dateiformat: binär, little-endian
  // Record Messages (mesg_num = 20) enthalten GPS-Daten
  // Vereinfachter Parser — sucht nach Semicircle lat/lng Werten

  try {
    const view = new DataView(data.buffer)
    let offset = 0

    // FIT Header überspringen (12 oder 14 Bytes)
    const headerSize = data[0]
    offset = headerSize

    // Datei durchsuchen nach GPS-Koordinaten-Mustern
    // FIT speichert lat/lng als Semicircles (signed 32-bit int)
    // Umrechnung: degrees = semicircles * (180 / 2^31)
    const SEMICIRCLE_TO_DEG = 180 / Math.pow(2, 31)

    while (offset < data.length - 8) {
      // Plausible lat/lng Paare im Alpenraum suchen
      // Lat: ~44-48 Grad = ~520093696 bis ~568996864 Semicircles
      // Lng: ~5-16 Grad = ~59652324 bis ~190888636 Semicircles

      try {
        const val1 = view.getInt32(offset, true)
        const val2 = view.getInt32(offset + 4, true)

        const lat = val1 * SEMICIRCLE_TO_DEG
        const lng = val2 * SEMICIRCLE_TO_DEG

        if (lat >= 43 && lat <= 49 && lng >= 4 && lng <= 18) {
          // Plausible alpine GPS-Koordinate
          let elevation: number | undefined = undefined
          if (offset + 8 < data.length) {
            // Höhe folgt oft nach lat/lng
            const rawElev = view.getUint16(offset + 8, true)
            if (rawElev > 0 && rawElev < 10000) {
              elevation = rawElev / 5 - 500 // FIT Höhen-Kodierung
            }
          }

          // Nur hinzufügen wenn nicht zu nah am vorherigen Punkt (Duplikate vermeiden)
          const last = points[points.length - 1]
          if (!last || Math.abs(lat - last.lat) > 0.00001 || Math.abs(lng - last.lng) > 0.00001) {
            points.push({ lat, lng, elevation })
          }
        }
      } catch (_e) {
        // Ungültige Reads überspringen
      }

      offset += 1 // Byte für Byte scannen
    }
  } catch (e) {
    console.error('FIT Parse Fehler:', e)
  }

  return points
}

// Haversine-Distanz in Metern
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
