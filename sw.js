/*
 * SIAP BK Service Worker — percepat repeat visit & offline ringan
 * Taruh di root project: https://rikiarifin.github.io/siapbk/sw.js
 * (scope /siapbk/ — mencakup semua subfolder sekolah)
 * Versi: 1.0 — 2026-11-16
 */
var CACHE_VERSION = 'siapbk-v1';
var CACHE_STATIS = CACHE_VERSION + '-statis';   // CDN, fonts, gambar (immutable)
var CACHE_DINAMIS = CACHE_VERSION + '-dinamis'; // app shell, data GET (SWR)

// CDN & aset immutable yang aman di-cache selamanya (cache-first)
var POLA_CACHE_FIRST = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'lh3.googleusercontent.com',
  '/siapbk/ikon.svg'
];

// Hapus cache lama saat install
self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) {
          // Jangan sentuh cache bawaan aplikasi (siapbk-tampilan)
          return k.indexOf(CACHE_VERSION) === -1 && k.indexOf('siapbk-tampilan') === -1;
        }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// Normalisasi URL: hapus parameter cache-buster ?t= agar cache key stabil
function normalisasiUrl(url) {
  try {
    var u = new URL(url);
    u.searchParams.delete('t');
    return u.toString();
  } catch (err) { return url; }
}

function termasuk(host, pola) {
  for (var i = 0; i < pola.length; i++) {
    var p = pola[i];
    if (p.charAt(0) === '/') { if (urlPathCocok(host, p)) return true; }
    else if (host.indexOf(p) !== -1) return true;
  }
  return false;
}
function urlPathCocok(host, path) { return host.pathname.indexOf(path) !== -1; }

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // 1) POST tidak pernah di-cache (data harus fresh) — lewat ke network
  if (req.method !== 'GET') { return; }

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 2) Aplikasi punya cache sendiri untuk HTML tampilan — jangan ganggu
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    // GET echo (data) — stale-while-revalidate: tampilkan cache lama, update di latar
    event.respondWith(
      caches.open(CACHE_DINAMIS).then(function (cache) {
        var urlNorm = normalisasiUrl(req.url);
        return cache.match(urlNorm).then(function (cached) {
          var fetchPromise = fetch(req).then(function (res) {
            if (res && res.status === 200) { cache.put(urlNorm, res.clone()); }
            return res;
          }).catch(function () { return cached; });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // 3) CDN / fonts / gambar — cache-first (paling cepat, immutable)
  if (termasuk(url, POLA_CACHE_FIRST)) {
    event.respondWith(
      caches.open(CACHE_STATIS).then(function (cache) {
        return cache.match(req).then(function (cached) {
          if (cached) return cached;
          return fetch(req).then(function (res) {
            if (res && res.status === 200) { cache.put(req, res.clone()); }
            return res;
          });
        });
      })
    );
    return;
  }

  // 4) App shell (index.html) — network-first, fallback ke cache saat offline
  event.respondWith(
    caches.open(CACHE_DINAMIS).then(function (cache) {
      return fetch(req).then(function (res) {
        if (res && res.status === 200) { cache.put(req, res.clone()); }
        return res;
      }).catch(function () {
        return cache.match(req);
      });
    })
  );
});

// Pesan dari halaman: SKIP_WAITING agar update langsung aktif
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') { self.skipWaiting(); }
});
