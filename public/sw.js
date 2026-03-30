const CACHE_NAME = 'rmc-ememo-v1'
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
]

// Install event - cache files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✅ Cache opened')
        return cache.addAll(urlsToCache)
      })
      .catch(err => console.log('❌ Cache failed:', err))
  )
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🧹 Deleting old cache:', cacheName)
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
  self.clients.claim()
})

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return
  }

  // Network first for API calls
  if (event.request.url.includes('/api/') || 
      event.request.url.includes('/user/') ||
      event.request.url.includes('/login') ||
      event.request.url.includes('/send') ||
      event.request.url.includes('/broadcast')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Clone the response
          const clonedResponse = response.clone()
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clonedResponse)
          })
          return response
        })
        .catch(() => {
          // If network fails, try cache
          return caches.match(event.request)
        })
    )
    return
  }

  // Cache first for static assets
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response
        }
        return fetch(event.request)
          .then(response => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type === 'error') {
              return response
            }
            // Clone the response
            const clonedResponse = response.clone()
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, clonedResponse)
            })
            return response
          })
          .catch(() => {
            // Return a offline page or cached response if available
            console.log('📡 Offline: Could not fetch', event.request.url)
            return new Response('Offline - Unable to load resource', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            })
          })
      })
  )
})

// Background sync for offline actions (future enhancement)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-memos') {
    event.waitUntil(
      // Handle offline memo sending
      Promise.resolve()
    )
  }
})
