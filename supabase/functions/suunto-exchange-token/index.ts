// Gipfelkönig — Suunto OAuth Token Exchange
// Tauscht den OAuth-Code gegen echte Suunto-Tokens

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code } = await req.json()
    if (!code) {
      return new Response(JSON.stringify({ error: 'Code fehlt' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // User aus JWT Token
    const authHeader = req.headers.get('Authorization')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') ?? ''
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Code gegen Tokens tauschen bei Suunto
    const tokenResponse = await fetch('https://cloudapi-oauth.suunto.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: Deno.env.get('SUUNTO_CLIENT_ID')!,
        client_secret: Deno.env.get('SUUNTO_CLIENT_SECRET')!,
        redirect_uri: Deno.env.get('SUUNTO_REDIRECT_URI') || 'https://bergkoenig.app/settings.html'
      })
    })

    const tokenData = await tokenResponse.json()

    if (!tokenData.access_token) {
      console.error('Suunto Token-Tausch fehlgeschlagen:', tokenData)
      return new Response(JSON.stringify({ error: 'Token-Tausch fehlgeschlagen', details: tokenData }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Tokens in DB speichern
    const { error: updateError } = await supabase.from('user_profiles').update({
      suunto_token: tokenData.access_token,
      suunto_refresh_token: tokenData.refresh_token,
      suunto_token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      suunto_user_id: tokenData.user || null,
      suunto_connected_at: new Date().toISOString()
    }).eq('id', user.id)

    if (updateError) {
      console.error('DB Update fehlgeschlagen:', updateError)
      return new Response(JSON.stringify({ error: 'Speichern fehlgeschlagen' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Suunto Exchange Error:', err)
    return new Response(JSON.stringify({ error: 'Server-Fehler' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
