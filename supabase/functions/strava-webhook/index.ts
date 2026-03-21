// Gipfelkönig — Strava Webhook Handler
// Empfängt Events von Strava und leitet neue Aktivitäten weiter

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  // GET: Webhook-Verifikation von Strava
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

  // POST: Neue Aktivität von Strava
  if (req.method === 'POST') {
    try {
      const body = await req.json()

      // Nur neue Aktivitäten verarbeiten
      if (body.object_type !== 'activity' || body.aspect_type !== 'create') {
        return new Response('Ignoriert (kein neuer Activity-Event)', { status: 200 })
      }

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
        return new Response('User not found', { status: 404 })
      }

      // Token-Refresh prüfen
      let accessToken = user.strava_token
      if (user.strava_token_expires_at && new Date(user.strava_token_expires_at) < new Date()) {
        // Token abgelaufen → Refresh
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

          // Neue Tokens speichern
          await supabase
            .from('user_profiles')
            .update({
              strava_token: tokens.access_token,
              strava_refresh_token: tokens.refresh_token,
              strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString()
            })
            .eq('id', user.id)
        } else {
          console.error('Token-Refresh fehlgeschlagen')
          return new Response('Token refresh failed', { status: 500 })
        }
      }

      // process-activity Edge Function aufrufen
      const { error: invokeError } = await supabase.functions.invoke('process-activity', {
        body: {
          user_id: user.id,
          activity_id: body.object_id,
          strava_token: accessToken
        }
      })

      if (invokeError) {
        console.error('process-activity Fehler:', invokeError)
        return new Response('Processing error', { status: 500 })
      }

      return new Response('OK', { status: 200 })
    } catch (error) {
      console.error('Webhook Fehler:', error)
      return new Response('Internal error', { status: 500 })
    }
  }

  return new Response('Method not allowed', { status: 405 })
})
