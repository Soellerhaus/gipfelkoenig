// Gipfelkönig — Account komplett löschen
// Löscht alle Daten des Users: Summits, Badges, Ownership, Profil, Auth

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Kein Auth-Header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace('Bearer ', '')

    // User-Client um den eingeloggten User zu identifizieren
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )
    const { data: { user }, error: authError } = await userClient.auth.getUser()

    if (authError || !user) {
      console.error('Auth Error:', authError?.message)
      return new Response(JSON.stringify({ error: 'Nicht autorisiert: ' + (authError?.message || 'kein User') }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Admin-Client für Lösch-Operationen
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const userId = user.id

    // 1. Strava deautorisieren (falls verbunden)
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('strava_token')
      .eq('id', userId)
      .single()

    if (profile?.strava_token) {
      await fetch('https://www.strava.com/oauth/deauthorize', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${profile.strava_token}` }
      }).catch(() => {}) // Fehler ignorieren wenn Token abgelaufen
    }

    // 2. Badges löschen
    await supabase.from('badges').delete().eq('user_id', userId)

    // 3. Summits löschen
    await supabase.from('summits').delete().eq('user_id', userId)

    // 4. Ownership: user_id auf NULL setzen
    await supabase.from('ownership')
      .update({ user_id: null, summit_count: 0 })
      .eq('user_id', userId)

    // 5. User-Profil löschen
    await supabase.from('user_profiles').delete().eq('id', userId)

    // 6. Auth User löschen (muss als letztes)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)
    if (deleteError) {
      console.error('Auth User löschen fehlgeschlagen:', deleteError)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Delete Account Error:', err)
    return new Response(JSON.stringify({ error: 'Löschen fehlgeschlagen' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
