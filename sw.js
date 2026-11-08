/* Big Ben Chimes service worker — cache-first local shell.
 * Works OFFLINE after the first load. Caches LOCAL files only.
 *
 * ⚠ CACHE name must be bumped whenever ANY cached file changes — the new
 * cache name activates the updated service worker, and the activate step
 * deletes the old cache. That is the deploy cache-bust mechanism.
 * (Convention: coder branches ship the right starting name; main applies
 * the bump when merging/deploying, one bump per release.) */
const CACHE = 'bigben-chimes-v1.2.0';

const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'chime.js',
  'app.js',
  'manifest.json',
  'audio/melody.m4a',
  'audio/melody.ogg',
  'audio/bong.m4a',
  'audio/bong.ogg',
  'audio/q45.m4a',
  'audio/q45.ogg',
  'audio/q30.m4a',
  'audio/q30.ogg',
  'audio/q15.m4a',
  'audio/q15.ogg',
  'photo/bigben.jpg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS.map(function (asset) {
        return new Request(asset, { cache: 'reload' });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf('bigben-chimes-') === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // local shell only

  // Media elements load audio/images with byte-range requests. A plain 200
  // answer makes Chrome stall forever (readyState 0, no error), so slice the
  // cached full body into a real 206. Falls back to the network when online,
  // which also keeps the FIRST load working before the SW has cached anything.
  if (req.headers.has('range')) {
    e.respondWith(rangeFromCache(req));
    return;
  }

  e.respondWith(
    cachedResponse(req).then(function (hit) {
      // A release cache is immutable. Background refresh mixed new files into
      // old releases and made a network request on every cached page load.
      return hit || fetch(req);
    })
  );
});

function cachedResponse(req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true });
  });
}

/* Answer a Range request from the cached full response (206 slice). */
function rangeFromCache(req) {
  return cachedResponse(req).then(function (hit) {
    if (!hit) return fetch(req); // not cached yet: native network path
    const range = req.headers.get('range') || '';
    const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    if (!m || (!m[1] && !m[2])) return hit; // ignore malformed/multi-range
    return hit.arrayBuffer().then(function (buf) {
      // Content-Length may be absent or describe a compressed transfer. Range
      // offsets address the decoded cached body, not that header's byte count.
      const total = buf.byteLength;
      let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
      }
      const slice = buf.slice(start, end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          'Content-Type': hit.headers.get('content-type') || 'application/octet-stream',
          'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
          'Content-Length': String(slice.byteLength)
        }
      });
    });
  });
}
