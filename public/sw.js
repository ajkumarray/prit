/*
 * Service worker.
 *
 * Two jobs. The first is that Chrome will not offer to install a site without
 * one that handles fetch — so this is a hard requirement for the install
 * button, not a nice-to-have. The second is a usable offline state: the shell
 * loads and says what's wrong, rather than showing the browser's error page.
 *
 * Deliberately conservative about what it caches. Audio comes from YouTube and
 * the track list from /api, and serving either from a stale cache would be
 * worse than failing honestly.
 */

const CACHE = 'prit-radio-v1'
const SHELL = ['/', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One bad URL would reject addAll and abort the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Leave other origins alone entirely — YouTube's player and Spotify's album
  // art must not be touched by us.
  if (url.origin !== self.location.origin) return

  // Never cache the synced playlist; a stale one defeats the point of syncing.
  if (url.pathname.startsWith('/api/')) return

  // Pages: network first, falling back to the last copy we saw.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match('/'))),
    )
    return
  }

  // Build output is content-hashed, so it's safe to serve from cache first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && /^\/(_next\/static|icon-|apple-touch-)/.test(url.pathname)) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
