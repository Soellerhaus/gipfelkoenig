// Bergkönig — Service Worker
// Cache-Strategie: Cache First für Assets, Network First für API

const CACHE_NAME = 'gipfelkoenig-v2'

const OFFLINE_HTML = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bergk\u00f6nig — Offline</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1814;color:#f0ece4;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}.box{max-width:360px}.mountain{font-size:4rem;margin-bottom:1rem}.title{font-size:1.5rem;font-weight:700;margin-bottom:0.5rem}.title span{color:#c9a84c}.msg{color:#888;font-size:0.95rem;line-height:1.6;margin-bottom:1.5rem}.btn{display:inline-block;background:#c9a84c;color:#1a1814;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;cursor:pointer;border:none}.btn:active{opacity:0.8}</style></head><body><div class="box"><div class="mountain">\u26f0\ufe0f</div><div class="title">Berg<span>k\u00f6nig</span></div><p class="msg">Keine Internetverbindung.<br>Pr\u00fcfe dein WLAN oder mobile Daten und versuche es erneut.</p><button class="btn" onclick="location.reload()">Erneut versuchen</button></div></body></html>'
const STATIC_ASSETS = [
  '/app.html',
  '/css/base.css',
  '/css/components.css',
  '/css/layout.css',
  '/js/api.js',
  '/js/auth.js',
  '/js/map.js',
  '/js/summits.js',
  '/js/game.js',
  '/js/notifications.js',
  '/manifest.json',
  '/icons/icon.svg'
]

// Installation: Statische Assets cachen
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Cache statische Assets')
      return cache.addAll(STATIC_ASSETS)
    })
  )
  self.skipWaiting()
})

// Aktivierung: Alte Caches löschen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

// Fetch-Strategie
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // API-Calls: Network First (Supabase, Strava, ALBINA)
  if (url.hostname.includes('supabase') ||
      url.hostname.includes('strava') ||
      url.hostname.includes('avalanche') ||
      url.hostname.includes('overpass')) {
    event.respondWith(networkFirst(event.request))
    return
  }

  // Externe Ressourcen (Fonts, Leaflet Tiles): Cache First
  if (url.hostname !== self.location.hostname) {
    event.respondWith(cacheFirst(event.request))
    return
  }

  // Eigene Assets: Cache First
  event.respondWith(cacheFirst(event.request))
})

// Cache First: Cache prüfen, bei Miss vom Netzwerk laden
async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    // Offline-Fallback: Schöne Seite statt "Site can't be reached"
    if (request.mode === 'navigate') {
      return new Response(OFFLINE_HTML, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }
    return new Response('Offline', { status: 503 })
  }
}

// Network First: Netzwerk versuchen, bei Fehler Cache
async function networkFirst(request) {
  try {
    const response = await fetch(request)
    return response
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// Push Notification Handler
self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()
  const options = {
    body: data.body || 'Neue Benachrichtigung',
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    vibrate: [100, 50, 100],
    data: data.url ? { url: data.url } : {}
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Bergkönig', options)
  )
})

// Notification Klick → App öffnen
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/app.html'
  event.waitUntil(
    self.clients.openWindow(url)
  )
})
