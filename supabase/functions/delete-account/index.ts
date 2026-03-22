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

    // Admin-Client (Service Role — kann alles)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // User aus dem JWT Token identifizieren
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      console.error('Auth Error:', authError?.message, 'Token prefix:', token.substring(0, 20))
      return new Response(JSON.stringify({ error: 'Nicht autorisiert: ' + (authError?.message || 'kein User') }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const userId = user.id

    console.log('Deleting account for user:', userId)

    // 1. Strava deautorisieren
    try {
      const { data: profile } = await supabase
        .from('user_profiles').select('strava_token').eq('id', userId).single()
      if (profile?.strava_token) {
        await fetch('https://www.strava.com/oauth/deauthorize', {
          method: 'POST', headers: { 'Authorization': `Bearer ${profile.strava_token}` }
        }).catch(() => {})
      }
    } catch (e) { console.log('Strava deauth skip:', e.message) }

    // 2. Badges löschen (ignoriere Fehler)
    try { await supabase.from('badges').delete().eq('user_id', userId) }
    catch (e) { console.log('Badges skip:', e.message) }

    // 3. Summits löschen
    try { await supabase.from('summits').delete().eq('user_id', userId) }
    catch (e) { console.log('Summits skip:', e.message) }

    // 4. Ownership nullen
    try { await supabase.from('ownership').update({ user_id: null, summit_count: 0 }).eq('user_id', userId) }
    catch (e) { console.log('Ownership skip:', e.message) }

    // 5. User-Profil löschen
    try { await supabase.from('user_profiles').delete().eq('id', userId) }
    catch (e) { console.log('Profile skip:', e.message) }

    // 6. Auth User löschen
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)
    if (deleteError) console.error('Auth delete failed:', deleteError.message)

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
