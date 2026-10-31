// Offline support: keep a copy of the app on the device. Bump VERSION whenever any file changes.
const VERSION = "bsc-v5";
const FILES = ["./", "index.html", "styles.css", "app.js", "engine.js", "tableio.js", "importers.js", "readers.js", "xml.js", "metrics.js", "biz.js",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
  "vendor/jszip.min.js", "vendor/pdf.min.mjs", "vendor/pdf.worker.min.mjs"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
