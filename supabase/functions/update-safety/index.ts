// Gipfelkönig — ALBINA Cron Job
// Läuft täglich um 17:30 Uhr, holt Lawinenlagebericht für alle relevanten Regionen
// Speichert Gefahrenstufen in safety_status Tabelle

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Regionen die wir tracken
const TRACKED_REGIONS = ['AT-08', 'AT-07', 'DE-BY', 'IT-32-BZ']

// EAWS Gefahrenstufen Mapping
const DANGER_MAP: Record<string, number> = {
  'low': 1,
  'moderate': 2,
  'considerable': 3,
  'high': 4,
  'very_high': 5
}

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Aktuelles Bulletin-Datum ermitteln
    const latestRes = await fetch('https://api.avalanche.report/albina/api/bulletins/latest')
    const latestData = await latestRes.json()
    const pubDate = new Date(latestData.date)
    const validDate = new Date(pubDate)
    validDate.setUTCDate(validDate.getUTCDate() + 1)
    const dateStr = validDate.toISOString().split('T')[0]

    console.log(`Aktualisiere Sicherheitsdaten für ${dateStr}`)

    const results: any[] = []

    for (const regionId of TRACKED_REGIONS) {
      try {
        // EAWS Ratings für Region laden
        const ratingsUrl = `https://static.avalanche.report/eaws_bulletins/${dateStr}/${dateStr}-${regionId}.ratings.json`
        const ratingsRes = await fetch(ratingsUrl)

        if (!ratingsRes.ok) {
          console.log(`Keine Ratings für ${regionId} (${ratingsRes.status})`)
          continue
        }

        const ratings = await ratingsRes.json()

        // Maximale Gefahrenstufe für die Region berechnen
        // Nur Hauptregionen (ohne :am/:pm/:high/:low Suffixe)
        const mainRatings = Object.entries(ratings.maxDangerRatings)
          .filter(([key]) => key.startsWith(regionId) && !key.includes(':'))
          .map(([, level]) => level as number)

        const maxLevel = mainRatings.length > 0 ? Math.max(...mainRatings) : 0

        // In safety_status speichern (upsert)
        const { error } = await supabase
          .from('safety_status')
          .upsert({
            region_id: regionId,
            date: dateStr,
            danger_level: maxLevel,
            bulletin_url: `https://avalanche.report/bulletin/${dateStr}`,
            raw_data: ratings.maxDangerRatings
          }, {
            onConflict: 'region_id,date'
          })

        if (error) {
          console.error(`Fehler beim Speichern für ${regionId}:`, error)
        }

        results.push({
          region: regionId,
          danger_level: maxLevel,
          is_safe: maxLevel <= 2,
          subregions: mainRatings.length
        })

        console.log(`${regionId}: Stufe ${maxLevel} (${maxLevel <= 2 ? 'sicher' : 'GEFAHR'})`)
      } catch (regionError) {
        console.error(`Fehler bei Region ${regionId}:`, regionError)
      }
    }

    return new Response(JSON.stringify({
      date: dateStr,
      updated: results.length,
      results
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('update-safety Fehler:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
