/* ============================================================
   Service Worker SIAP BK — Optimasi Performa (v2)
   ------------------------------------------------------------
   Strategi cache:
   - CDN (jsdelivr), Google Fonts, gambar Drive: cache-first
   - Aset static asal sama (landing page, ikon): stale-while-revalidate
   - Semua request ke Apps Script (script.google.com): bypass/network-only
     (karena tampilan HTML & data sudah dikelola langsung oleh launcher)
   ============================================================ */

var CACHE_VERSION = 'siapbk-v2';
var STATIC_CACHE = CACHE_VERSION + '-static';
var CDN_CACHE = CACHE_VERSION + '-cdn';

var ALL_CACHES = [STATIC_CACHE, CDN_CACHE];

// Domain eksternal yang di-cache dengan strategi cache-first
var CDN_DOMAINS = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com'
];

// Aset static yang di-precache saat install
var PRECACHE_URLS = [
  '/siapbk/ikon.svg'
];

/* ---------- INSTALL: pre-cache aset static ---------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(PRECACHE_URLS).catch(function () {
        return Promise.resolve();
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ---------- ACTIVATE: bersihkan seluruh cache versi lama ---------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      var hapus = names.filter(function (name) {
        return name.indexOf('siapbk-') === 0 && ALL_CACHES.indexOf(name) === -1;
      });
      return Promise.all(hapus.map(function (name) { return caches.delete(name); }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------- HELPERS ---------- */
function termasukDomain(url, daftarDomain) {
  return daftarDomain.some(function (d) { return url.hostname === d || url.hostname.endsWith('.' + d); });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var fetchPromise = fetch(request).then(function (response) {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function () {
        return cached;
      });
      return cached || fetchPromise;
    });
  });
}

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && (response.status === 200 || response.type === 'opaque')) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function () {
        return cached;
      });
    });
  });
}

function networkFirst(request, cacheName) {
  return fetch(request).then(function (response) {
    if (response && response.status === 200) {
      caches.open(cacheName).then(function (cache) { cache.put(request, response.clone()); });
    }
    return response;
  }).catch(function () {
    return caches.open(cacheName).then(function (cache) { return cache.match(request); });
  });
}

/* ---------- FETCH: routing strategi cache ---------- */
self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  // 1) Semua request ke Google Apps Script: langsung ke jaringan (bypass SW)
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    return;
  }

  // Hanya cache request GET
  if (request.method !== 'GET') return;

  // 2) CDN / Fonts / Gambar Drive: cache-first
  if (termasukDomain(url, CDN_DOMAINS)) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  // 3) Aset static asal sama (landing page, ikon.svg)
  if (url.origin === location.origin) {
    if (request.mode === 'navigate' || request.destination === 'document') {
      event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
      return;
    }
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 4) Lainnya: network-first dengan fallback cache
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

/* ---------- MESSAGE: komunikasi dengan halaman ---------- */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_APP_CACHE') {
    caches.delete('siapbk-tampilan').then(function () {
      event.source && event.source.postMessage({ type: 'APP_CACHE_CLEARED' });
    });
  }
});
