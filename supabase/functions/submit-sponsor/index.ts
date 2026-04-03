// Bergkönig — Sponsor/Partner Anmeldung
// Öffentliches Formular — kein Auth nötig, status='pending' bis Admin freischaltet

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const body = await req.json()

    // Pflichtfelder validieren
    const required = ['company_name', 'contact_email', 'contact_name', 'prize_name']
    for (const field of required) {
      if (!body[field] || !body[field].trim()) {
        return new Response(JSON.stringify({ error: `${field} ist erforderlich` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // E-Mail Format prüfen
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contact_email)) {
      return new Response(JSON.stringify({ error: 'Ungültige E-Mail-Adresse' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Vertrag muss akzeptiert sein
    if (!body.contract_accepted) {
      return new Response(JSON.stringify({ error: 'Vertragsbedingungen müssen akzeptiert werden' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data, error } = await supabase.from('sponsors').insert({
      company_name: body.company_name.trim(),
      contact_email: body.contact_email.trim(),
      contact_name: body.contact_name.trim(),
      logo_url: body.logo_url || null,
      website_url: body.website_url || null,
      product_url: body.product_url || null,
      prize_name: body.prize_name.trim(),
      prize_description: body.prize_description || null,
      prize_image_url: body.prize_image_url || null,
      prize_value: body.prize_value || null,
      hex_regions: body.hex_regions || [],
      all_regions: body.all_regions || false,
      contract_accepted: true,
      status: 'pending'
    }).select('id').single()

    if (error) {
      console.error('DB Insert Fehler:', error)
      return new Response(JSON.stringify({ error: 'Speichern fehlgeschlagen: ' + error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('Neuer Sponsor-Antrag:', body.company_name, data?.id)

    return new Response(JSON.stringify({ success: true, id: data?.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Submit-Sponsor Fehler:', err)
    return new Response(JSON.stringify({ error: 'Server-Fehler' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
