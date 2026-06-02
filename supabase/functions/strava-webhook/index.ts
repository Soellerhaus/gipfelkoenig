// Gipfelkönig — Strava Webhook Handler (gehärtet)
// Empfängt Events von Strava und leitet neue Aktivitäten weiter.
//
// WICHTIG (Stabilitaet): Auf POST-Events antworten wir IMMER sofort mit 200.
// Strava deaktiviert ein Webhook-Abo, wenn der Endpoint wiederholt mit 4xx/5xx
// antwortet. Darum laeuft die gesamte Verarbeitung (User-Suche, Token-Refresh,
// process-activity) im Hintergrund via EdgeRuntime.waitUntil — Fehler werden
// nur geloggt, niemals als Fehlercode an Strava zurueckgegeben.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Verarbeitet ein einzelnes Activity-Create-Event vollstaendig im Hintergrund.
// Wirft NIE — alle Fehler werden geloggt, damit Strava trotzdem 200 sieht.
async function handleActivityCreate(body: any): Promise<void> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Finde User anhand Strava Athlete ID
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('id, strava_token, strava_refresh_token, strava_token_expires_at')
      .eq('strava_id', body.owner_id.toString())
      .single()

    if (userError || !user) {
      console.error('User nicht gefunden für Strava ID:', body.owner_id)
      return // Kein Fehlercode an Strava — einfach ignorieren
    }

    // Token-Refresh prüfen
    let accessToken = user.strava_token
    if (user.strava_token_expires_at && new Date(user.strava_token_expires_at) < new Date()) {
      const refreshResponse = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: Deno.env.get('STRAVA_CLIENT_ID'),
          client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
          grant_type: 'refresh_token',
          refresh_token: user.strava_refresh_token
        })
      })

      if (refreshResponse.ok) {
        const tokens = await refreshResponse.json()
        accessToken = tokens.access_token
        await supabase
          .from('user_profiles')
          .update({
            strava_token: tokens.access_token,
            strava_refresh_token: tokens.refresh_token,
            strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString()
          })
          .eq('id', user.id)
      } else {
        console.error('Token-Refresh fehlgeschlagen für User', user.id)
        return // Nicht weiter — aber Strava bekommt trotzdem 200
      }
    }

    // process-activity Edge Function aufrufen — direkter fetch mit Service-Role-Key
    // (supabase.functions.invoke() reicht den Auth-Header nicht durch → 401)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const res = await fetch(`${supabaseUrl}/functions/v1/process-activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
      },
      body: JSON.stringify({
        user_id: user.id,
        activity_id: body.object_id,
        strava_token: accessToken
      })
    })

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      console.error(`process-activity HTTP ${res.status}: ${txt}`)
    } else {
      console.log(`process-activity OK fuer ${body.object_id}`)
    }
  } catch (e) {
    console.error('handleActivityCreate Fehler:', e)
  }
}

serve(async (req) => {
  // GET: Webhook-Verifikation von Strava (Handshake bei Abo-Anlage)
  // Strava sendet einen Challenge-String den wir zurückgeben müssen
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const challenge = url.searchParams.get('hub.challenge')
    const verifyToken = url.searchParams.get('hub.verify_token')

    if (verifyToken !== Deno.env.get('STRAVA_VERIFY_TOKEN')) {
      return new Response('Unauthorized', { status: 401 })
    }

    return new Response(
      JSON.stringify({ 'hub.challenge': challenge }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  // POST: Event von Strava — IMMER sofort 200, Verarbeitung im Hintergrund.
  if (req.method === 'POST') {
    let body: any = null
    try {
      body = await req.json()
    } catch (_e) {
      // Unlesbarer Body — trotzdem 200, damit Strava nicht deaktiviert
      console.error('Webhook: Body nicht parsebar')
      return new Response('OK', { status: 200 })
    }

    // Nur neue Aktivitäten verarbeiten — alles andere still ignorieren (200)
    if (body && body.object_type === 'activity' && body.aspect_type === 'create') {
      const work = handleActivityCreate(body)
      // EdgeRuntime.waitUntil haelt den Worker am Leben bis die Arbeit fertig ist,
      // OHNE die 200-Antwort zu verzoegern.
      // @ts-ignore — EdgeRuntime ist Supabase-spezifisch
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work)
      } else {
        // Fallback: nicht awaiten wuerde den Worker evtl. zu frueh beenden
        await work
      }
    }

    // Strava bekommt IMMER 200 — egal was passiert
    return new Response('OK', { status: 200 })
  }

  // GET/POST abgedeckt; alles andere ist fuer Strava irrelevant
  return new Response('OK', { status: 200 })
})
