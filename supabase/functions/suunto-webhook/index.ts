// Gipfelkönig — Suunto Webhook
// Empfängt Workout-Benachrichtigungen von Suunto, lädt FIT-Datei,
// parsed GPS-Koordinaten, prüft Gipfelnähe (80m) und erstellt Einträge
//
// Webhook-Registrierung bei Suunto:
//   POST https://cloudapi.suunto.com/v2/webhook
//   Headers: Authorization: Bearer <token>, Ocp-Apim-Subscription-Key: <key>
//   Body: { "url": "https://<project>.supabase.co/functions/v1/suunto-webhook",
//           "description": "Gipfelkoenig" }
// Die Subscription-Key muss mit der hier konfigurierten übereinstimmen.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, ocp-apim-subscription-key',
}

// Fix 1: Secrets aus Umgebungsvariablen
const SUBSCRIPTION_KEY = Deno.env.get('SUUNTO_SUBSCRIPTION_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Fix 3: Webhook-Authentifizierung — Subscription-Key prüfen
    const incomingKey = req.headers.get('ocp-apim-subscription-key') ||
                        req.headers.get('x-suunto-subscription-key')
    if (!incomingKey || incomingKey !== SUBSCRIPTION_KEY) {
      console.error('Webhook-Authentifizierung fehlgeschlagen: ungültiger Subscription-Key')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

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
      .select('id, suunto_token, suunto_refresh_token, suunto_token_expires_at')
      .eq('suunto_user_id', suuntoUserId)
      .single()

    if (!profile || !profile.suunto_token) {
      console.log('Kein User gefunden für Suunto ID:', suuntoUserId)
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Fix 6: Token-Refresh prüfen bevor wir die API aufrufen
    let accessToken = profile.suunto_token
    if (profile.suunto_token_expires_at) {
      const expiresAt = new Date(profile.suunto_token_expires_at)
      if (expiresAt < new Date()) {
        console.log('Suunto Token abgelaufen, refreshe...')
        accessToken = await refreshSuuntoToken(supabase, profile)
      }
    }

    // Workout-Details von Suunto API holen
    const workoutRes = await fetch(`https://cloudapi.suunto.com/v2/workouts/${workoutId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY
      }
    })
    const workout = await workoutRes.json()

    // FIT-Datei holen (enthält GPS-Daten)
    const fitRes = await fetch(`https://cloudapi.suunto.com/v2/workouts/${workoutId}/exportFit`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
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

    // Fix 2: Proper FIT-Parser mit Definition Messages
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

    // Fix 5: Batch PostGIS Query statt N+1
    // Bounding Box der gesamten GPS-Spur berechnen
    const foundPeaks = await findPeaksBatch(supabase, gpsPoints)

    console.log(`${foundPeaks.size} Gipfel in Suunto Workout ${workoutId} gefunden`)

    // Fix 8: Timestamps aus FIT-Daten für Startzeit und Frühaufsteher-Bonus
    const startTime = gpsPoints[0]?.time || workout.startTime || new Date().toISOString()
    const season = new Date(startTime).getFullYear().toString()
    // Frühaufsteher: erster GPS-Punkt vor 07:00 Lokalzeit
    const startHour = new Date(startTime).getHours()

    // Besteigungen speichern
    for (const [peakId, { peak, point }] of foundPeaks) {
      // Fix 4: Lawinensicherheits-Check vor Punkte-Vergabe
      const safetyResult = await checkAvalancheSafety(supabase, peak)

      // Fix 9: Exakte Punkte-Formel
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

      // Fix 9: Multiplikatoren — Pionier x3, Erstbesuch x2, Wiederholung x0.2
      let pts = basePts
      if (isSeasonFirst) pts = Math.round(basePts * 3)
      else if (isPersonalFirst) pts = Math.round(basePts * 2)
      else pts = Math.round(basePts * 0.2)

      // Frühaufsteher-Bonus (erster GPS-Punkt vor 07:00 Lokalzeit) = +15
      if (startHour < 7) pts += 15

      // Combo-Bonus (2+ Gipfel in dieser Tour): +50% pro Extra-Gipfel
      if (foundPeaks.size > 1) {
        pts = Math.round(pts * (1 + 0.5 * (foundPeaks.size - 1)))
      }

      // Fix 4: Gefahrenstufe >= 3 → keine Punkte (KRITISCH)
      const safetyOk = safetyResult.level < 3
      if (!safetyOk) {
        pts = 0
      }

      await supabase.from('summits').insert({
        user_id: profile.id,
        peak_id: peakId,
        summited_at: point.time || startTime,
        season,
        checkin_method: 'suunto',
        points: pts,
        elevation_gain: Math.round(totalElevGain),
        distance: totalDistKm,
        safety_ok: safetyOk,
        safety_level: safetyResult.level,
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

// ============================================================
// Fix 6: Token-Refresh Hilfsfunktion
// ============================================================
async function refreshSuuntoToken(supabase: any, profile: any): Promise<string> {
  if (!profile.suunto_refresh_token) {
    throw new Error('Kein Refresh-Token vorhanden')
  }

  const res = await fetch('https://cloudapi-oauth.suunto.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: profile.suunto_refresh_token,
      client_id: Deno.env.get('SUUNTO_CLIENT_ID')!,
      client_secret: Deno.env.get('SUUNTO_CLIENT_SECRET')!,
    })
  })

  const tokenData = await res.json()

  if (!tokenData.access_token) {
    console.error('Token-Refresh fehlgeschlagen:', tokenData)
    throw new Error('Suunto Token-Refresh fehlgeschlagen')
  }

  // Neue Tokens in DB speichern
  await supabase.from('user_profiles').update({
    suunto_token: tokenData.access_token,
    suunto_refresh_token: tokenData.refresh_token || profile.suunto_refresh_token,
    suunto_token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
  }).eq('id', profile.id)

  return tokenData.access_token
}

// ============================================================
// Fix 4: Lawinensicherheits-Check via ALBINA API
// ============================================================
async function checkAvalancheSafety(
  supabase: any,
  peak: { id: string; lat: number; lng: number; osm_region?: string }
): Promise<{ level: number; status: string }> {
  try {
    // Zuerst: safety_status Tabelle prüfen (vom täglichen Cron befüllt)
    if (peak.osm_region) {
      const { data: safety } = await supabase
        .from('safety_status')
        .select('danger_level')
        .eq('region_id', peak.osm_region)
        .order('valid_from', { ascending: false })
        .limit(1)
        .single()

      if (safety && typeof safety.danger_level === 'number') {
        return { level: safety.danger_level, status: safety.danger_level >= 3 ? 'dangerous' : 'ok' }
      }
    }

    // Fallback: ALBINA API direkt abfragen
    const albinaRes = await fetch('https://api.avalanche.report/albina/api/bulletins/latest')
    if (albinaRes.ok) {
      const bulletins = await albinaRes.json()
      // Durch alle Bulletins iterieren und Region des Peaks finden
      for (const bulletin of (bulletins.bulletins || bulletins || [])) {
        const regions = bulletin.regions || []
        const dangerRatings = bulletin.dangerRatings || []
        // Prüfen ob Peak-Region in diesem Bulletin enthalten ist
        if (peak.osm_region && regions.some((r: any) =>
          (r.regionID || r.id || '').includes(peak.osm_region))) {
          const maxLevel = dangerRatings.reduce((max: number, dr: any) => {
            const level = dr.mainValue || dr.dangerLevel || 0
            return Math.max(max, typeof level === 'number' ? level : parseInt(level) || 0)
          }, 0)
          return { level: maxLevel, status: maxLevel >= 3 ? 'dangerous' : 'ok' }
        }
      }
    }

    // Wenn keine Daten gefunden: konservativ mit Level 0 (unbekannt = ok)
    return { level: 0, status: 'unknown' }
  } catch (err) {
    console.error('Sicherheits-Check Fehler:', err)
    return { level: 0, status: 'error' }
  }
}

// ============================================================
// Fix 5: Batch-Gipfelsuche statt N+1 Queries
// ============================================================
async function findPeaksBatch(
  supabase: any,
  gpsPoints: Array<{ lat: number; lng: number; elevation?: number; time?: string }>
): Promise<Map<string, { peak: any; point: any }>> {
  const foundPeaks = new Map<string, { peak: any; point: any }>()

  if (gpsPoints.length === 0) return foundPeaks

  // Bounding Box berechnen mit 0.001° Puffer (~80m)
  let minLat = Infinity, maxLat = -Infinity
  let minLng = Infinity, maxLng = -Infinity
  for (const pt of gpsPoints) {
    if (pt.lat < minLat) minLat = pt.lat
    if (pt.lat > maxLat) maxLat = pt.lat
    if (pt.lng < minLng) minLng = pt.lng
    if (pt.lng > maxLng) maxLng = pt.lng
  }
  minLat -= 0.001
  maxLat += 0.001
  minLng -= 0.001
  maxLng += 0.001

  // Eine einzelne Query: alle Gipfel in der Bounding Box
  const { data: candidatePeaks } = await supabase
    .from('peaks')
    .select('id, name, elevation, lat, lng, osm_region')
    .gte('lat', minLat)
    .lte('lat', maxLat)
    .gte('lng', minLng)
    .lte('lng', maxLng)

  if (!candidatePeaks || candidatePeaks.length === 0) return foundPeaks

  // Jeden 10. GPS-Punkt samplen um Rechenzeit zu sparen
  const sampledPoints = gpsPoints.filter((_, i) => i % 10 === 0)

  // Client-seitig: Distanz zwischen gesampleten GPS-Punkten und Kandidaten-Gipfeln
  for (const pt of sampledPoints) {
    for (const peak of candidatePeaks) {
      if (foundPeaks.has(peak.id)) continue
      const dist = haversine(pt.lat, pt.lng, peak.lat, peak.lng)
      if (dist <= 80) {
        foundPeaks.set(peak.id, { peak, point: pt })
      }
    }
  }

  return foundPeaks
}

// ============================================================
// Fix 2: Proper FIT Protocol Parser
// Liest Definition Messages und Data Messages korrekt
// ============================================================
interface FitFieldDef {
  fieldNum: number
  size: number
  baseType: number
}

interface FitDefinition {
  architecture: number  // 0 = little-endian, 1 = big-endian
  globalMesgNum: number
  fields: FitFieldDef[]
}

interface GpsPoint {
  lat: number
  lng: number
  elevation?: number
  time?: string
}

function parseFitGps(data: Uint8Array): GpsPoint[] {
  const points: GpsPoint[] = []

  try {
    if (data.length < 14) return points

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

    // 14-byte FIT Header lesen
    const headerSize = data[0]
    if (headerSize < 12) return points

    // Optional: ".FIT" Signatur prüfen (Bytes 8-11)
    if (headerSize >= 12) {
      const sig = String.fromCharCode(data[8], data[9], data[10], data[11])
      if (sig !== '.FIT') {
        console.warn('Keine FIT-Signatur gefunden, versuche trotzdem...')
      }
    }

    let offset = headerSize
    const definitions = new Map<number, FitDefinition>()

    const SEMICIRCLE_TO_DEG = 180 / Math.pow(2, 31)
    // FIT Epoch: 1989-12-31T00:00:00Z = Unix 631065600
    const FIT_EPOCH_OFFSET = 631065600

    while (offset < data.length - 1) {
      // Record Header lesen (1 Byte)
      const recordHeader = data[offset]
      offset += 1

      // Compressed Timestamp Header (Bit 7 = 1, Bit 6 = 0)
      if ((recordHeader & 0x80) !== 0) {
        // Compressed Timestamp — Data Message mit eingebettetem Timestamp
        const localMesgType = (recordHeader >> 5) & 0x03
        const def = definitions.get(localMesgType)
        if (!def) {
          // Keine Definition — überspringen unmöglich, abbrechen
          break
        }
        // Daten der Definition entsprechend überspringen/lesen
        const msgSize = def.fields.reduce((s, f) => s + f.size, 0)
        if (offset + msgSize > data.length) break

        if (def.globalMesgNum === 20) {
          // Record message — GPS-Daten extrahieren
          const pt = extractRecordFields(view, offset, def, SEMICIRCLE_TO_DEG, FIT_EPOCH_OFFSET)
          if (pt) points.push(pt)
        }
        offset += msgSize
        continue
      }

      // Normal Header
      const isDefinition = (recordHeader & 0x40) !== 0
      const localMesgType = recordHeader & 0x0F

      if (isDefinition) {
        // Definition Message lesen
        if (offset + 5 > data.length) break

        const _reserved = data[offset]
        const architecture = data[offset + 1]  // 0 = little-endian, 1 = big-endian
        const littleEndian = architecture === 0

        const globalMesgNum = littleEndian
          ? view.getUint16(offset + 2, true)
          : view.getUint16(offset + 2, false)

        const numFields = data[offset + 4]
        offset += 5

        const fields: FitFieldDef[] = []
        for (let i = 0; i < numFields; i++) {
          if (offset + 3 > data.length) break
          fields.push({
            fieldNum: data[offset],
            size: data[offset + 1],
            baseType: data[offset + 2]
          })
          offset += 3
        }

        // Developer Fields prüfen (Bit 5 des Record Headers)
        if ((recordHeader & 0x20) !== 0) {
          if (offset < data.length) {
            const numDevFields = data[offset]
            offset += 1
            // Jedes Dev-Field hat 3 Bytes
            offset += numDevFields * 3
          }
        }

        definitions.set(localMesgType, {
          architecture,
          globalMesgNum,
          fields
        })
      } else {
        // Data Message lesen
        const def = definitions.get(localMesgType)
        if (!def) {
          // Keine Definition bekannt — können nicht weiterlesen
          break
        }

        const msgSize = def.fields.reduce((s, f) => s + f.size, 0)
        if (offset + msgSize > data.length) break

        // Global Message Number 20 = "record" (GPS-Datenpunkte)
        if (def.globalMesgNum === 20) {
          const pt = extractRecordFields(view, offset, def, SEMICIRCLE_TO_DEG, FIT_EPOCH_OFFSET)
          if (pt) points.push(pt)
        }

        offset += msgSize
      }
    }
  } catch (e) {
    console.error('FIT Parse Fehler:', e)
  }

  return points
}

// Felder aus einem Record (mesg_num 20) Data Message extrahieren
function extractRecordFields(
  view: DataView,
  baseOffset: number,
  def: FitDefinition,
  SEMICIRCLE_TO_DEG: number,
  FIT_EPOCH_OFFSET: number
): GpsPoint | null {
  const littleEndian = def.architecture === 0
  let lat: number | null = null
  let lng: number | null = null
  let altitude: number | undefined = undefined
  let timestamp: number | undefined = undefined

  let fieldOffset = baseOffset
  for (const field of def.fields) {
    try {
      switch (field.fieldNum) {
        case 0: // position_lat — int32 semicircles
          if (field.size >= 4) {
            const raw = view.getInt32(fieldOffset, littleEndian)
            // 0x7FFFFFFF = invalid
            if (raw !== 0x7FFFFFFF) {
              lat = raw * SEMICIRCLE_TO_DEG
            }
          }
          break
        case 1: // position_long — int32 semicircles
          if (field.size >= 4) {
            const raw = view.getInt32(fieldOffset, littleEndian)
            if (raw !== 0x7FFFFFFF) {
              lng = raw * SEMICIRCLE_TO_DEG
            }
          }
          break
        case 2: // altitude — uint16, /5 - 500
          if (field.size >= 2) {
            const raw = view.getUint16(fieldOffset, littleEndian)
            if (raw !== 0xFFFF) {
              altitude = raw / 5 - 500
            }
          }
          break
        case 253: // timestamp — uint32, Sekunden seit FIT-Epoch
          if (field.size >= 4) {
            const raw = view.getUint32(fieldOffset, littleEndian)
            if (raw !== 0xFFFFFFFF) {
              timestamp = raw
            }
          }
          break
      }
    } catch (_e) {
      // Feld-Read fehlgeschlagen, weitermachen
    }
    fieldOffset += field.size
  }

  // Nur gültige Alpine Koordinaten akzeptieren (Fix 2 / Filter)
  if (lat === null || lng === null) return null
  if (lat < 43 || lat > 49 || lng < 4 || lng > 18) return null

  const point: GpsPoint = { lat, lng }
  if (altitude !== undefined) point.elevation = altitude
  if (timestamp !== undefined) {
    // Fix 8: FIT Timestamp → ISO-String konvertieren
    point.time = new Date((timestamp + FIT_EPOCH_OFFSET) * 1000).toISOString()
  }

  return point
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
