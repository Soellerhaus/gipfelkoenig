// Bergkönig — send-push Edge Function
// Sendet Web-Push-Benachrichtigungen an die Geräte eines Users.
// Aufruf (service_role) z.B. aus process-activity:
//   POST /functions/v1/send-push
//   { "user_id": "...", "title": "...", "body": "...", "url": "/app.html", "tag": "crown" }
// Tote/abgelaufene Subscriptions (404/410) werden automatisch entfernt.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:soellerhaus@gmail.com"

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const payload = await req.json()

    // Zwei Aufruf-Arten unterstützen:
    // 1) Direkter Aufruf: { user_id|user_ids, title, body, url, icon, tag }
    // 2) Supabase Database Webhook auf notifications: { type:'INSERT', record:{...} }
    let user_id: string | undefined
    let title: string | undefined
    let body: string | undefined
    let url: string | undefined
    let icon: string | undefined
    let tag: string | undefined

    if (payload && payload.record && (payload.type === "INSERT" || payload.table === "notifications")) {
      const r = payload.record
      user_id = r.user_id
      title = r.title
      body = r.body
      // r.icon ist ein Emoji (z.B. 👑) — NICHT als Bild-Icon verwenden,
      // sonst lädt der Service Worker einen ungültigen Pfad. Standard-PNG nutzen.
      tag = r.type
    } else {
      user_id = payload.user_id
      title = payload.title
      body = payload.body
      url = payload.url
      icon = payload.icon
      tag = payload.tag
    }

    const userIds: string[] = payload.user_ids || (user_id ? [user_id] : [])

    if (userIds.length === 0 || !title || !body) {
      return new Response(
        JSON.stringify({ error: "user_id(s), title und body erforderlich" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Alle Subscriptions der Ziel-User laden
    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", userIds)

    if (error) throw error
    if (!subs || subs.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, note: "keine Abos" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const notification = JSON.stringify({
      title,
      body,
      url: url || "/app.html",
      icon: icon || "/icons/icon-192.png",
      tag: tag || undefined,
    })

    let sent = 0
    const deadIds: string[] = []

    await Promise.all(
      subs.map(async (s) => {
        const subscription = {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        }
        try {
          await webpush.sendNotification(subscription, notification, { TTL: 86400 })
          sent++
        } catch (err: any) {
          const code = err?.statusCode
          // 404/410 → Subscription ist tot und sollte gelöscht werden
          if (code === 404 || code === 410) {
            deadIds.push(s.id)
          } else {
            console.error("Push-Fehler:", code, err?.body || err?.message)
          }
        }
      })
    )

    // Tote Subscriptions aufräumen
    if (deadIds.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", deadIds)
    }

    return new Response(
      JSON.stringify({ sent, removed: deadIds.length, total: subs.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (e: any) {
    console.error("send-push Fehler:", e?.message || e)
    return new Response(
      JSON.stringify({ error: e?.message || "unbekannter Fehler" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
