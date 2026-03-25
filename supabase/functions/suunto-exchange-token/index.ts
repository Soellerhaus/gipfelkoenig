// Bergkönig — Suunto OAuth Token Exchange
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

  // IMMER 200 zurückgeben, Fehler im Body
  const ok = (data: any) => new Response(JSON.stringify(data), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })

  try {
    const body = await req.json().catch(() => ({}))
    const code = body.code
    if (!code) return ok({ error: 'Code fehlt', step: 'parse' })

    // User prüfen
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
    const userId = userData.user.id

    // Suunto Credentials prüfen
    const clientId = Deno.env.get('SUUNTO_CLIENT_ID')
    const clientSecret = Deno.env.get('SUUNTO_CLIENT_SECRET')
    const redirectUri = Deno.env.get('SUUNTO_REDIRECT_URI') || 'https://bergkoenig.app/settings.html'

    if (!clientId || !clientSecret) {
      return ok({ error: 'Suunto Credentials fehlen', step: 'config',
        hasClientId: !!clientId, hasSecret: !!clientSecret })
    }

    // Token tauschen bei Suunto (Basic Auth)
    const basicAuth = btoa(clientId + ':' + clientSecret)
    const tokenResp = await fetch('https://cloudapi-oauth.suunto.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + basicAuth
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      })
    })

    const tokenText = await tokenResp.text()
    let tokenData: any
    try { tokenData = JSON.parse(tokenText) } catch { tokenData = { raw: tokenText } }

    if (!tokenResp.ok || !tokenData.access_token) {
      return ok({
        error: 'Suunto Token-Tausch fehlgeschlagen',
        step: 'token',
        suunto_status: tokenResp.status,
        suunto_body: tokenData,
        used_redirect: redirectUri,
        used_client: clientId.substring(0, 8) + '...'
      })
    }

    // Token in DB speichern
    const { error: dbError } = await supabase.from('user_profiles').update({
      suunto_token: tokenData.access_token,
      suunto_refresh_token: tokenData.refresh_token || null,
      suunto_token_expires_at: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null,
      suunto_user_id: tokenData.user || null,
      suunto_connected_at: new Date().toISOString()
    }).eq('id', userId)

    if (dbError) {
      return ok({ error: 'DB-Speichern fehlgeschlagen', step: 'db', detail: dbError.message })
    }

    return ok({ success: true })

  } catch (err) {
    return ok({ error: 'Server-Fehler: ' + (err as Error).message, step: 'crash' })
  }
})
