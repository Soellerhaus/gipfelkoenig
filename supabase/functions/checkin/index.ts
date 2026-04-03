// Gipfelkönig — Manueller Gipfel Check-in
// Für Wanderer ohne Strava: GPS-Position → Gipfelerkennung → Punkte

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Einheitliche Punkte-Berechnung: HM/100 + km + 10 Gipfelbonus
// Bei manuellem Check-in: Höhe/2 als HM-Schätzung (Aufstieg ~halbe Gipfelhöhe), km=0
function calculatePoints(
  elevation: number,
  isPersonalFirst: boolean,
  isSeasonFirst: boolean,
  isEarly: boolean
): number {
  // Schätzung: Aufstiegs-HM ≈ Gipfelhöhe/2 (typischer Start auf halber Höhe)
  const estimatedHM = Math.round((elevation || 1000) / 2)
  const basePts = Math.round(estimatedHM / 100) + 10 // HM/100 + Gipfelbonus, keine km bei Check-in

  let pts = basePts
  if (isSeasonFirst) pts = Math.round(basePts * 3)
  else if (isPersonalFirst) pts = Math.round(basePts * 2)
  else pts = Math.round(basePts * 0.5)

  if (isEarly) pts += 15

  return Math.round(pts)
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    // Auth prüfen
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // User aus JWT Token extrahieren
    const userSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await userSupabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { lat, lng } = await req.json()
    if (!lat || !lng) {
      return new Response(JSON.stringify({ error: 'lat und lng sind erforderlich' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const now = new Date()
    const season = now.getFullYear().toString()
    const dateStr = now.toISOString().split('T')[0]

    // Gipfel innerhalb 80m suchen
    // Fallback-Query mit Lat/Lng Approximation (0.001° ≈ 111m)
    const { data: nearbyPeaks, error: peakError } = await supabase
      .from('peaks')
      .select('*')
      .gte('lat', lat - 0.001)
      .lte('lat', lat + 0.001)
      .gte('lng', lng - 0.001)
      .lte('lng', lng + 0.001)
      .eq('is_active', true)

    if (peakError) {
      console.error('Peak-Suche Fehler:', peakError)
      return new Response(JSON.stringify({ error: 'Datenbankfehler' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Haversine-Filter: Nur Gipfel innerhalb 80m
    const peak = (nearbyPeaks || []).find(p => {
      const dist = haversineDistance(lat, lng, p.lat, p.lng)
      return dist <= 80
    })

    if (!peak) {
      return new Response(JSON.stringify({
        success: false,
        reason: 'no_peak',
        message: 'Kein bekannter Gipfel in deiner Nähe (80m Radius)'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Season Check
    const month = now.getMonth() + 1
    const day = now.getDate()
    const monthDay = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    if (monthDay < peak.season_from || monthDay > peak.season_to) {
      return new Response(JSON.stringify({
        success: false,
        reason: 'off_season',
        message: `${peak.name} ist außerhalb der Saison (${peak.season_from} bis ${peak.season_to})`
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // SICHERHEITS-CHECK (KRITISCH: Stufe >= 3 → KEINE Punkte)
    const { data: safety } = await supabase
      .from('safety_status')
      .select('danger_level, is_safe')
      .eq('region_id', peak.osm_region)
      .eq('date', dateStr)
      .single()

    if (safety && !safety.is_safe) {
      return new Response(JSON.stringify({
        success: false,
        reason: 'unsafe',
        message: `${peak.name} ist heute gesperrt (Lawinenstufe ${safety.danger_level})`,
        danger_level: safety.danger_level
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Duplikat-Check: War der User heute schon auf diesem Gipfel?
    const todayStart = new Date(dateStr + 'T00:00:00Z')
    const todayEnd = new Date(dateStr + 'T23:59:59Z')

    const { count: todayCount } = await supabase
      .from('summits')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('peak_id', peak.id)
      .gte('summited_at', todayStart.toISOString())
      .lte('summited_at', todayEnd.toISOString())

    if ((todayCount || 0) > 0) {
      return new Response(JSON.stringify({
        success: false,
        reason: 'duplicate',
        message: `Du warst heute bereits auf ${peak.name}`
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Punkte berechnen
    const { count: personalCount } = await supabase
      .from('summits')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('peak_id', peak.id)

    const isPersonalFirst = (personalCount || 0) === 0

    const { count: seasonCount } = await supabase
      .from('summits')
      .select('*', { count: 'exact', head: true })
      .eq('peak_id', peak.id)
      .eq('season', season)

    const isSeasonFirst = (seasonCount || 0) === 0

    const isEarly = now.getHours() < 7
    const points = calculatePoints(
      peak.elevation,
      isPersonalFirst,
      isSeasonFirst,
      isEarly
    )

    // Summit speichern (summited_at = aktuelle Uhrzeit)
    await supabase.from('summits').insert({
      user_id: user.id,
      peak_id: peak.id,
      summited_at: now.toISOString(),
      season,
      checkin_method: 'manual',
      points,
      is_season_first: isSeasonFirst,
      is_personal_first: isPersonalFirst,
      safety_ok: true,
      safety_level: safety?.danger_level || 0
    })

    // Ownership aktualisieren
    const { data: currentOwner } = await supabase
      .from('ownership')
      .select('user_id, summit_count')
      .eq('peak_id', peak.id)
      .eq('season', season)
      .single()

    const { count: userSummitCount } = await supabase
      .from('summits')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('peak_id', peak.id)
      .eq('season', season)
      .eq('safety_ok', true)

    if (!currentOwner) {
      await supabase.from('ownership').insert({
        peak_id: peak.id,
        season,
        user_id: user.id,
        summit_count: userSummitCount || 1,
        king_since: now.toISOString(),
        last_summited: now.toISOString()
      })
    } else if ((userSummitCount || 0) > currentOwner.summit_count) {
      await supabase.from('ownership').update({
        user_id: user.id,
        summit_count: userSummitCount || 1,
        king_since: now.toISOString(),
        last_summited: now.toISOString()
      }).eq('peak_id', peak.id).eq('season', season)
    }

    // User-Punkte aktualisieren
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('total_points')
      .eq('id', user.id)
      .single()

    await supabase
      .from('user_profiles')
      .update({ total_points: (profile?.total_points || 0) + points })
      .eq('id', user.id)

    return new Response(JSON.stringify({
      success: true,
      peak: {
        id: peak.id,
        name: peak.name,
        elevation: peak.elevation
      },
      points,
      isPersonalFirst,
      isSeasonFirst,
      summitTime: now.toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('checkin Fehler:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

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
