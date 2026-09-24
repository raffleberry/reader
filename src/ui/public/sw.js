/* Reader demo service worker: offline-first app shell.
 * Registered only by the static demo build (see src/main.ts); the server
 * build never loads this file. Books already live in IndexedDB, so once the
 * shell (HTML/JS/CSS) is cached the whole reading side works with no network.
 */

const CACHE = "reader-demo-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add("./"))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // book/CDN traffic stays live
  event.respondWith(
    caches.match(req).then((hit) => {
      const go = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || caches.match("./"));
      return hit || go;
    }),
  );
});
