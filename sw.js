/* ============================================================
   Service Worker SIAP BK — Optimasi Performa
   ------------------------------------------------------------
   Strategi cache:
   - CDN (jsdelivr), Google Fonts, gambar Drive: cache-first
     (jarang berubah, hemat ~500KB+ setiap kunjungan ulang)
   - Aset static asal sama (landing page, ikon): stale-while-revalidate
   - HTML aplikasi (?mode=html): stale-while-revalidate
     (URL dinormalisasi — parameter ?t= cache-buster diabaikan)
   - POST API (doPost): network-only (data harus selalu fresh)
   - Lainnya: network-first
   
   Cara update: naikkan CACHE_VERSION agar cache lama dihapus.
   ============================================================ */

var CACHE_VERSION = 'siapbk-v1';
var STATIC_CACHE = CACHE_VERSION + '-static';
var CDN_CACHE = CACHE_VERSION + '-cdn';
var APP_CACHE = CACHE_VERSION + '-app';

var ALL_CACHES = [STATIC_CACHE, CDN_CACHE, APP_CACHE];

// Domain yang di-cache dengan strategi cache-first
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
        // Jika gagal (mis. file belum ada), tetap lanjut install
        return Promise.resolve();
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ---------- ACTIVATE: bersihkan cache versi lama ---------- */
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

// Normalisasi URL app HTML: buang parameter ?t= (cache-buster) agar
// semua request ?mode=html pakai cache key yang sama.
function normalisasiUrlApp(url) {
  try {
    var u = new URL(url);
    if (u.searchParams.get('mode') === 'html') {
      u.searchParams.delete('t');
      return u.toString();
    }
  } catch (e) {}
  return url;
}

function adalahRequestAppHtml(request) {
  if (request.method !== 'GET') return false;
  try {
    var u = new URL(request.url);
    return u.hostname === 'script.google.com' && u.searchParams.get('mode') === 'html';
  } catch (e) { return false; }
}

function adalahRequestApiPost(request) {
  return request.method === 'POST' && request.url.indexOf('script.google.com/macros/s/') !== -1;
}

// Stale-While-Revalidate: sajikan dari cache seketika,
// ambil versi baru di latar, simpan untuk kunjungan berikutnya.
function staleWhileRevalidate(request, cacheName, cacheKey) {
  var key = cacheKey || request;
  return caches.open(cacheName).then(function (cache) {
    return cache.match(key).then(function (cached) {
      var fetchPromise = fetch(request).then(function (response) {
        if (response && response.status === 200) {
          cache.put(key, response.clone());
        }
        return response;
      }).catch(function () {
        return cached; // offline: kembalikan cache
      });
      return cached || fetchPromise;
    });
  });
}

// Cache-first: kalau ada di cache, pakai; kalau tidak, ambil & simpan.
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
        return cached; // offline
      });
    });
  });
}

// Network-first: coba network dulu, fallback ke cache saat offline/lambat.
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

  // 1) POST API: jangan di-cache, selalu network (data harus fresh)
  if (adalahRequestApiPost(request)) {
    return; // pass-through ke network
  }

  // 2) HTML aplikasi dari Apps Script (?mode=html): SWR dengan key ternormalisasi
  if (adalahRequestAppHtml(request)) {
    var cacheKey = normalisasiUrlApp(request.url);
    event.respondWith(staleWhileRevalidate(request, APP_CACHE, cacheKey));
    return;
  }

  // 3) CDN / Fonts / Gambar Drive: cache-first (jarang berubah)
  if (termasukDomain(url, CDN_DOMAINS)) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  // 4) Aset static asal sama (landing page, ikon.svg): SWR
  if (url.origin === location.origin) {
    // Jangan cache request navigasi utama (index.html) — biarkan SWR
    if (request.mode === 'navigate' || request.destination === 'document') {
      event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
      return;
    }
    // Aset static lain (ikon, dll): cache-first
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 5) Lainnya: network-first dengan fallback cache
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

/* ---------- MESSAGE: komunikasi dengan halaman ---------- */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_APP_CACHE') {
    // Hapus cache app HTML (digunakan saat developer update aplikasi)
    caches.delete(APP_CACHE).then(function () {
      event.source && event.source.postMessage({ type: 'APP_CACHE_CLEARED' });
    });
  }
});
