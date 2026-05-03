#!/usr/bin/env node
// Bergkönig — Strava Webhook Subscription Manager
//
// Aufgaben:
// - Status der aktuellen Webhook-Subscription anzeigen
// - Tote Subscription löschen + neu anlegen
// - Verify dass die richtige Callback-URL hinterlegt ist
//
// Verwendung:
//   STRAVA_CLIENT_ID=xxx STRAVA_CLIENT_SECRET=yyy STRAVA_VERIFY_TOKEN=zzz \
//     node scripts/manage-webhook.js status
//   node scripts/manage-webhook.js fix       # löscht alte + legt neue an
//   node scripts/manage-webhook.js delete    # nur löschen
//
// Strava CLIENT_ID + CLIENT_SECRET findest du unter:
// https://www.strava.com/settings/api

const SUPABASE_PROJECT_REF = 'wbrvkweezbeakfphssxp'
const CALLBACK_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/strava-webhook`

const CLIENT_ID = process.env.STRAVA_CLIENT_ID
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET
const VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN

if (!CLIENT_ID || !CLIENT_SECRET || !VERIFY_TOKEN) {
  console.error('FEHLER: Setze die ENV-Variablen:')
  console.error('  STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN')
  console.error('')
  console.error('Beispiel:')
  console.error('  STRAVA_CLIENT_ID=12345 STRAVA_CLIENT_SECRET=abc... STRAVA_VERIFY_TOKEN=gipfelkoenig_webhook_2026 node scripts/manage-webhook.js fix')
  process.exit(1)
}

const action = process.argv[2] || 'status'

async function listSubscriptions() {
  const url = `https://www.strava.com/api/v3/push_subscriptions?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
  const res = await fetch(url)
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`List failed: ${res.status} ${txt}`)
  }
  return res.json()
}

async function deleteSubscription(id) {
  const url = `https://www.strava.com/api/v3/push_subscriptions/${id}?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    const txt = await res.text()
    throw new Error(`Delete failed: ${res.status} ${txt}`)
  }
  return true
}

async function createSubscription() {
  const form = new URLSearchParams()
  form.append('client_id', CLIENT_ID)
  form.append('client_secret', CLIENT_SECRET)
  form.append('callback_url', CALLBACK_URL)
  form.append('verify_token', VERIFY_TOKEN)

  const res = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
    method: 'POST',
    body: form
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Create failed: ${res.status} ${JSON.stringify(data)}`)
  }
  return data
}

async function main() {
  console.log('=== Bergkönig Strava Webhook Manager ===')
  console.log('Callback-URL:', CALLBACK_URL)
  console.log('Verify-Token:', VERIFY_TOKEN)
  console.log('Action:', action)
  console.log('')

  const subs = await listSubscriptions()
  console.log('Aktuelle Subscriptions:', subs.length === 0 ? '(keine)' : '')
  for (const s of subs) {
    console.log(`  ID ${s.id}: ${s.callback_url}`)
    console.log(`    erstellt: ${s.created_at}, updated: ${s.updated_at}`)
  }
  console.log('')

  if (action === 'status') {
    const correct = subs.find(s => s.callback_url === CALLBACK_URL)
    if (correct) {
      console.log('✓ Subscription mit korrekter Callback-URL ist aktiv (ID ' + correct.id + ')')
      console.log('  Falls trotzdem keine Webhooks ankommen → Strava hat sie evtl. wegen 5xx-Antworten')
      console.log('  deaktiviert. Lauf "node scripts/manage-webhook.js fix" um neu zu registrieren.')
    } else if (subs.length > 0) {
      console.log('⚠ Subscriptions existieren, aber NICHT mit der richtigen URL!')
      console.log('  Lauf "node scripts/manage-webhook.js fix" um zu reparieren.')
    } else {
      console.log('✗ Keine Subscription registriert!')
      console.log('  Lauf "node scripts/manage-webhook.js fix" um neu anzulegen.')
    }
    return
  }

  if (action === 'delete' || action === 'fix') {
    for (const s of subs) {
      console.log(`Lösche Subscription ${s.id}...`)
      await deleteSubscription(s.id)
      console.log('  ✓ gelöscht')
    }
  }

  if (action === 'fix') {
    console.log('Lege neue Subscription an...')
    const newSub = await createSubscription()
    console.log('  ✓ erstellt: ID ' + newSub.id)
    console.log('')
    console.log('FERTIG. Webhook ist wieder aktiv.')
    console.log('Test: Eine Strava-Aktivität speichern und auf Bergkönig-Notification warten (~10s).')
  }
}

main().catch(err => {
  console.error('FEHLER:', err.message)
  process.exit(1)
})
