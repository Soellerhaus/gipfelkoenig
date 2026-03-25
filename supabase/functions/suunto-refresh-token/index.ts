// Gipfelkönig — Suunto Token Refresh
// Erneuert abgelaufene Suunto-Tokens für alle User.
// Kann als Cron-Job laufen oder vor dem FIT-Download aufgerufen werden.

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

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Alle User finden deren Token abgelaufen ist (oder in 5 Minuten abläuft)
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const { data: expiredProfiles, error: queryError } = await supabase
      .from('user_profiles')
      .select('id, suunto_refresh_token, suunto_token_expires_at')
      .not('suunto_refresh_token', 'is', null)
      .lt('suunto_token_expires_at', fiveMinFromNow)

    if (queryError) {
      console.error('Query-Fehler:', queryError)
      return new Response(JSON.stringify({ error: 'Query fehlgeschlagen' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!expiredProfiles || expiredProfiles.length === 0) {
      return new Response(JSON.stringify({ refreshed: 0, message: 'Keine abgelaufenen Tokens' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let refreshed = 0
    let failed = 0

    for (const profile of expiredProfiles) {
      try {
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

        if (tokenData.access_token) {
          await supabase.from('user_profiles').update({
            suunto_token: tokenData.access_token,
            suunto_refresh_token: tokenData.refresh_token || profile.suunto_refresh_token,
            suunto_token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          }).eq('id', profile.id)
          refreshed++
        } else {
          console.error(`Token-Refresh fehlgeschlagen für ${profile.id}:`, tokenData)
          failed++
        }
      } catch (err) {
        console.error(`Refresh-Fehler für ${profile.id}:`, err)
        failed++
      }
    }

    return new Response(JSON.stringify({
      refreshed,
      failed,
      total: expiredProfiles.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Suunto Refresh Fehler:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
