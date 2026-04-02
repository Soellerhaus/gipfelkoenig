// Bergkönig — Strava OAuth Token Exchange
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const ok = (data: any) => new Response(JSON.stringify(data), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })

  try {
    const body = await req.json().catch(() => ({}))
    const code = body.code
    if (!code) return ok({ error: 'Code fehlt', step: 'parse' })

    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (!token || token.length < 10) return ok({ error: 'Kein Auth-Token', step: 'auth' })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: userData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !userData?.user) {
      return ok({ error: 'Auth fehlgeschlagen', step: 'auth', detail: authError?.message })
    }

    const clientId = Deno.env.get('STRAVA_CLIENT_ID')
    const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET')
    if (!clientId || !clientSecret) {
      return ok({ error: 'Strava Credentials fehlen', step: 'config' })
    }

    const tokenResp = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code'
      })
    })

    const tokenText = await tokenResp.text()
    let tokenData: any
    try { tokenData = JSON.parse(tokenText) } catch { tokenData = { raw: tokenText } }

    if (!tokenResp.ok || !tokenData.access_token) {
      return ok({
        error: 'Strava Token-Tausch fehlgeschlagen',
        step: 'token',
        strava_status: tokenResp.status,
        strava_body: tokenData
      })
    }

    const { error: dbError } = await supabase.from('user_profiles').update({
      strava_id: tokenData.athlete?.id?.toString() || null,
      strava_token: tokenData.access_token,
      strava_refresh_token: tokenData.refresh_token,
      strava_token_expires_at: tokenData.expires_at
        ? new Date(tokenData.expires_at * 1000).toISOString()
        : null,
      strava_connected_at: new Date().toISOString()
    }).eq('id', userData.user.id)

    if (dbError) {
      return ok({ error: 'DB-Speichern fehlgeschlagen', step: 'db', detail: dbError.message })
    }

    return ok({ success: true })

  } catch (err) {
    return ok({ error: 'Server-Fehler: ' + (err as Error).message, step: 'crash' })
  }
})
