// Bergkönig — Service Worker
// Cache-Strategie: Cache First für Assets, Network First für API

const CACHE_NAME = 'gipfelkoenig-v1'
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
    // Offline-Fallback
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
