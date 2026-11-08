/* Big Ben Chimes service worker — cache-first local shell.
 * Works OFFLINE after the first load. Caches LOCAL files only.
 *
 * ⚠ CACHE name must be bumped whenever ANY cached file changes — the new
 * cache name activates the updated service worker, and the activate step
 * deletes the old cache. That is the deploy cache-bust mechanism.
 * (Convention: coder branches ship the right starting name; main applies
 * the bump when merging/deploying, one bump per release.) */
const CACHE = 'bigben-chimes-v1.0.1';

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
  'photo/bigben.jpg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
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
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) {
        // serve from cache; refresh it in the background when online
        fetch(req).then(function (resp) {
          if (resp && resp.ok) caches.open(CACHE).then(function (c) { c.put(req, resp); });
        }).catch(function () { /* offline: cached copy already served */ });
        return hit;
      }
      return fetch(req).then(function (resp) {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      });
    })
  );
});

/* Answer a Range request from the cached full response (206 slice). */
function rangeFromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    if (!hit) return fetch(req); // not cached yet: native network path
    const range = req.headers.get('range') || '';
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return hit;
    const total = Number(hit.headers.get('content-length'));
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (m[1] === '' && m[2] !== '') {
      // suffix range 'bytes=-N' means the LAST N bytes (RFC 7233), not the first
      start = Math.max(0, total - Number(m[2]));
      end = total - 1;
    }
    if (isNaN(total) || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': 'bytes */' + (isNaN(total) ? '*' : total) }
      });
    }
    return hit.arrayBuffer().then(function (buf) {
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
