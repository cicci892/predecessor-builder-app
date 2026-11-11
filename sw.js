const CACHE = "pb-v7";
const FILES = ["./", "index.html", "style.css", "effects.js", "itemfx.js", "richtext.js", "data/it.js", "data/reference/ref.js", "data/pesi.js", "kit.js", "model.js", "meta.js", "engine.js", "app.js", "data/data.js", "manifest.json"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));
self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
);
self.addEventListener("fetch", (e) =>
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
);
