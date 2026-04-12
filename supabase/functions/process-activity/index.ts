// Gipfelkönig — KERNLOGIK: GPS-Track Analyse + Gipfelerkennung
// Holt GPS-Track von Strava, findet Gipfel via PostGIS,
// prüft Sicherheit, berechnet Punkte, updated Ownership

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Punkte-Berechnung: HM/km nur beim ersten Gipfel, Combo-Gipfel nur Gipfelbonus
function calculatePoints(
  elevationGain: number,
  distanceKm: number,
  isPersonalFirst: boolean,
  isSeasonFirst: boolean,
  isFirstPeakInActivity: boolean,
  isEarly: boolean
): number {
  let basePts: number
  if (isFirstPeakInActivity) {
    basePts = Math.round((elevationGain || 0) / 100) + Math.round(distanceKm || 0) + 10
  } else {
    basePts = 10 // Combo-Gipfel: nur Gipfelbonus
  }

  let pts = basePts
  if (isSeasonFirst) pts = Math.round(basePts * 3)
  else if (isPersonalFirst) pts = Math.round(basePts * 2)
  else pts = Math.round(basePts * 0.5)

  if (isEarly && isFirstPeakInActivity) pts += 15

  return Math.round(pts)
}

// Aktuelle Saison berechnen
function getSeason(date: Date): string {
  return date.getFullYear().toString()
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const { user_id, activity_id, strava_token } = await req.json()

    if (!user_id || !activity_id || !strava_token) {
      return new Response('Fehlende Parameter', { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. GPS-Track von Strava holen (Streams: latlng, altitude, time)
    const streamsUrl = `https://www.strava.com/api/v3/activities/${activity_id}/streams?keys=latlng,altitude,time&key_type=stream`
    const streamsRes = await fetch(streamsUrl, {
      headers: { 'Authorization': `Bearer ${strava_token}` }
    })

    if (!streamsRes.ok) {
      console.error('Strava Streams Fehler:', streamsRes.status)
      return new Response('Strava API error', { status: 502 })
    }

    const streams = await streamsRes.json()
    const latlngStream = streams.find((s: any) => s.type === 'latlng')
    const timeStream = streams.find((s: any) => s.type === 'time')

    if (!latlngStream || !latlngStream.data || latlngStream.data.length === 0) {
      return new Response('Keine GPS-Daten in Aktivität', { status: 200 })
    }

    // 2. Activity Details für Startzeit holen
    const activityRes = await fetch(
      `https://www.strava.com/api/v3/activities/${activity_id}`,
      { headers: { 'Authorization': `Bearer ${strava_token}` } }
    )
    const activity = await activityRes.json()
    const activityStart = new Date(activity.start_date)

    // 3. Alle GPS-Punkte gegen peaks Tabelle prüfen (PostGIS 80m Radius)
    // Wir prüfen nicht jeden Punkt einzeln sondern nur die höchsten Punkte
    // und Punkte mit geringer Geschwindigkeit (= potenzielle Gipfelpausen)
    const gpsPoints: [number, number][] = latlngStream.data
    const foundPeaks = new Map<number, { lat: number, lng: number, timeOffset: number }>()

    // Prüfe jeden 10. Punkt und alle Punkte nahe lokalen Maxima
    for (let i = 0; i < gpsPoints.length; i += 10) {
      const [lat, lng] = gpsPoints[i]
      const timeOffset = timeStream?.data?.[i] || 0

      // PostGIS Query: Gipfel innerhalb 80m
      const { data: nearbyPeaks } = await supabase.rpc('find_nearby_peaks', {
        p_lat: lat,
        p_lng: lng,
        p_radius: 80
      }).select('id, name, elevation, osm_region, season_from, season_to')

      // Fallback: Direkte Query wenn RPC nicht existiert
      if (!nearbyPeaks) {
        const { data: peaks } = await supabase
          .from('peaks')
          .select('id, name, lat, lng, elevation, osm_region, season_from, season_to')
          .eq('reachable', true)
          .gte('lat', lat - 0.001)
          .lte('lat', lat + 0.001)
          .gte('lng', lng - 0.001)
          .lte('lng', lng + 0.001)

        if (peaks) {
          for (const peak of peaks) {
            // Haversine Distanz prüfen (80m)
            const dist = haversineDistance(lat, lng, peak.lat, peak.lng)
            if (dist <= 80 && !foundPeaks.has(peak.id)) {
              foundPeaks.set(peak.id, { lat, lng, timeOffset })
            }
          }
        }
        continue
      }

      for (const peak of nearbyPeaks || []) {
        if (!foundPeaks.has(peak.id)) {
          foundPeaks.set(peak.id, { lat, lng, timeOffset })
        }
      }
    }

    if (foundPeaks.size === 0) {
      return new Response(JSON.stringify({ message: 'Keine Gipfel gefunden', peaks: 0 }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const season = getSeason(activityStart)
    const isCombo = foundPeaks.size >= 2
    let totalPoints = 0
    const summitResults: any[] = []

    // 4. Für jeden gefundenen Gipfel verarbeiten
    for (const [peakId, gpsData] of foundPeaks) {
      // Peak-Daten laden (nur erreichbare Gipfel)
      const { data: peak } = await supabase
        .from('peaks')
        .select('*')
        .eq('id', peakId)
        .eq('reachable', true)
        .single()

      if (!peak) continue

      // Gipfel-Zeitpunkt berechnen
      const summitTime = new Date(activityStart.getTime() + (gpsData.timeOffset * 1000))

      // Season Check: Liegt Datum zwischen season_from und season_to?
      const month = summitTime.getMonth() + 1
      const day = summitTime.getDate()
      const dateStr = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
      const inSeason = dateStr >= peak.season_from && dateStr <= peak.season_to

      if (!inSeason) {
        console.log(`Gipfel ${peak.name} außerhalb der Saison (${dateStr})`)
        continue
      }

      // SICHERHEITS-CHECK (KRITISCH: Stufe >= 3 → KEINE Punkte)
      const summitDate = summitTime.toISOString().split('T')[0]
      const { data: safety } = await supabase
        .from('safety_status')
        .select('danger_level, is_safe')
        .eq('region_id', peak.osm_region)
        .eq('date', summitDate)
        .single()

      const safetyLevel = safety?.danger_level || 0
      const isSafe = safety ? safety.is_safe : true // Wenn kein Eintrag: sicher (Sommer)

      if (!isSafe) {
        console.log(`Gipfel ${peak.name} gesperrt (Gefahrenstufe ${safetyLevel})`)
        // Summit trotzdem speichern, aber ohne Punkte
        await supabase.from('summits').insert({
          user_id,
          peak_id: peakId,
          summited_at: summitTime.toISOString(),
          season,
          strava_activity_id: activity_id.toString(),
          checkin_method: 'strava',
          points: 0,
          safety_ok: false,
          safety_level: safetyLevel
        })
        continue
      }

      // Prüfe: Erster Besuch dieses Users auf diesem Gipfel?
      const { count: personalCount } = await supabase
        .from('summits')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .eq('peak_id', peakId)

      const isPersonalFirst = (personalCount || 0) === 0

      // Prüfe: Erster Besuch diese Saison (aller User)?
      const { count: seasonCount } = await supabase
        .from('summits')
        .select('*', { count: 'exact', head: true })
        .eq('peak_id', peakId)
        .eq('season', season)

      const isSeasonFirst = (seasonCount || 0) === 0

      // Punkte berechnen
      const elevGain = activity.total_elevation_gain ? Math.round(activity.total_elevation_gain) : 0
      const distKm = activity.distance ? Math.round(activity.distance / 1000) : 0
      const isEarly = summitTime.getHours() < 7

      // Erster Gipfel bekommt HM/km, weitere nur Gipfelbonus
      const peakIndex = [...foundPeaks.keys()].indexOf(peakId)
      const isFirstPeakInActivity = peakIndex === 0

      const points = calculatePoints(
        elevGain,
        distKm,
        isPersonalFirst,
        isSeasonFirst,
        isFirstPeakInActivity,
        isEarly
      )

      // Summit speichern
      await supabase.from('summits').insert({
        user_id,
        peak_id: peakId,
        summited_at: summitTime.toISOString(),
        season,
        strava_activity_id: activity_id.toString(),
        checkin_method: 'strava',
        points,
        elevation_gain: elevGain,
        distance: distKm * 1000,
        is_season_first: isSeasonFirst,
        is_personal_first: isPersonalFirst,
        safety_ok: true,
        safety_level: safetyLevel
      })

      totalPoints += points

      // Ownership aktualisieren
      const { data: currentOwner } = await supabase
        .from('ownership')
        .select('user_id, summit_count')
        .eq('peak_id', peakId)
        .eq('season', season)
        .single()

      // Zähle User-Summits für diesen Gipfel diese Saison
      const { count: userSummitCount } = await supabase
        .from('summits')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .eq('peak_id', peakId)
        .eq('season', season)
        .eq('safety_ok', true)

      if (!currentOwner) {
        // Noch kein König → User wird König
        await supabase.from('ownership').insert({
          peak_id: peakId,
          season,
          user_id,
          summit_count: userSummitCount || 1,
          king_since: new Date().toISOString(),
          last_summited: summitTime.toISOString()
        })
      } else if ((userSummitCount || 0) > currentOwner.summit_count) {
        // User hat mehr Besteigungen → User wird neuer König
        const previousKingId = currentOwner.user_id

        await supabase.from('ownership').update({
          user_id,
          summit_count: userSummitCount || 1,
          king_since: new Date().toISOString(),
          last_summited: summitTime.toISOString()
        }).eq('peak_id', peakId).eq('season', season)

        // NOTIFICATION: Krone erobert → alten König benachrichtigen
        if (previousKingId && previousKingId !== user_id) {
          const { data: attackerProfile } = await supabase
            .from('user_profiles').select('username').eq('id', user_id).single()
          const attackerName = attackerProfile?.username || 'Jemand'

          await supabase.from('notifications').insert({
            user_id: previousKingId,
            type: 'crown_lost',
            title: 'Krone verloren!',
            body: `${attackerName} hat deine Krone auf ${peak.name} (${peak.elevation}m) erobert!`,
            icon: '👑',
            data: { peak_id: peakId, challenger_id: user_id }
          })
        }
      } else if (currentOwner.user_id === user_id) {
        // User ist bereits König → Count aktualisieren
        await supabase.from('ownership').update({
          summit_count: userSummitCount || 1,
          last_summited: summitTime.toISOString()
        }).eq('peak_id', peakId).eq('season', season)
      } else if (currentOwner.user_id !== user_id) {
        // Jemand besteigt einen Gipfel wo ein anderer König ist — Angriff-Warnung
        const gap = currentOwner.summit_count - (userSummitCount || 0)
        if (gap <= 2 && gap > 0) {
          const { data: attackerProfile } = await supabase
            .from('user_profiles').select('username').eq('id', user_id).single()
          const attackerName = attackerProfile?.username || 'Jemand'

          await supabase.from('notifications').insert({
            user_id: currentOwner.user_id,
            type: 'crown_attack',
            title: 'Krone wird angegriffen!',
            body: `${attackerName} greift deine Krone auf ${peak.name} an! Noch ${gap} Vorsprung.`,
            icon: '⚔️',
            data: { peak_id: peakId, challenger_id: user_id, gap }
          })
        }
      }

      // NOTIFICATION: Pionier-Besteigung
      if (isSeasonFirst) {
        await supabase.from('notifications').insert({
          user_id,
          type: 'pioneer',
          title: 'Pionier!',
          body: `Du bist der Erste auf ${peak.name} (${peak.elevation}m) diese Saison! ×3 Punkte!`,
          icon: '⭐',
          data: { peak_id: peakId, points }
        })
      }

      summitResults.push({
        peak: peak.name,
        elevation: peak.elevation,
        points,
        isPersonalFirst,
        isSeasonFirst,
        summitTime: summitTime.toISOString()
      })
    }

    // User-Gesamtpunkte aktualisieren + Rang-Änderung prüfen
    if (totalPoints > 0) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('total_points, username')
        .eq('id', user_id)
        .single()

      const oldPoints = profile?.total_points || 0
      const newPoints = oldPoints + totalPoints

      await supabase
        .from('user_profiles')
        .update({ total_points: newPoints })
        .eq('id', user_id)

      // NOTIFICATION: Rang-Änderung — wer wurde überholt?
      try {
        // User die zwischen altem und neuem Punktestand liegen
        const { data: overtaken } = await supabase
          .from('user_profiles')
          .select('id, username, total_points')
          .gt('total_points', oldPoints)
          .lte('total_points', newPoints)
          .neq('id', user_id)
          .limit(5)

        if (overtaken && overtaken.length > 0) {
          const userName = profile?.username || 'Jemand'
          for (const victim of overtaken) {
            await supabase.from('notifications').insert({
              user_id: victim.id,
              type: 'rank_change',
              title: 'Überholt!',
              body: `${userName} hat dich in der Rangliste überholt!`,
              icon: '🏆',
              data: { overtaker_id: user_id }
            })
          }
        }
      } catch (rankErr) {
        console.warn('Rang-Notification Fehler:', rankErr)
      }
    }

    // Strava-Beschreibung ergänzen — bei JEDER Aktivität mit Punkten
    if (totalPoints > 0 && strava_token) {
      try {
        // Prüfe ob User Strava-Posting aktiviert hat (Default: true für neue User)
        const { data: userSettings } = await supabase
          .from('user_profiles')
          .select('strava_post_summits')
          .eq('id', user_id)
          .single()

        const postEnabled = userSettings?.strava_post_summits !== false // Default true

        if (postEnabled) {
          // Bestehende Beschreibung laden
          const actRes = await fetch(`https://www.strava.com/api/v3/activities/${activity_id}`, {
            headers: { 'Authorization': `Bearer ${strava_token}` }
          })
          const actData = await actRes.json()
          const existingDesc = actData.description || ''

          // Bergkönig-Text nur anhängen wenn noch nicht drin
          if (!existingDesc.includes('bergkoenig.app')) {
            let bergkoenigText = '\n---\n'

            // Gipfel-Zeilen (wenn Gipfel erkannt)
            if (summitResults.length > 0) {
              const peakLines = summitResults.map((s: any) => {
                let line = `⛰️ ${s.peak} (${s.elevation}m) · +${s.points} Pkt`
                if (s.isSeasonFirst) line += ' ⭐ Pionier'
                return line
              }).join('\n')
              bergkoenigText += peakLines

              // König-Status
              for (const s of summitResults) {
                if (s.isSeasonFirst) {
                  bergkoenigText += '\n👑 Neuer Bergkönig!'
                  break
                }
              }
            } else {
              // Keine Gipfel erkannt — nur Punkte anzeigen
              bergkoenigText += `🏃 +${totalPoints} Pkt`
            }

            bergkoenigText += '\n🏆 bergkoenig.app'

            const newDesc = existingDesc + bergkoenigText

            // Beschreibung updaten
            await fetch(`https://www.strava.com/api/v3/activities/${activity_id}`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${strava_token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ description: newDesc })
            })
            console.log('Strava-Beschreibung aktualisiert für Aktivität', activity_id)
          }
        }
      } catch (stravaErr) {
        // Nicht kritisch — Gipfel wurden trotzdem gespeichert
        console.warn('Strava-Beschreibung konnte nicht aktualisiert werden:', stravaErr)
      }
    }

    return new Response(JSON.stringify({
      message: `${summitResults.length} Gipfel verarbeitet`,
      totalPoints,
      summits: summitResults
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('process-activity Fehler:', error)
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
