/// <reference lib="webworker" />
/**
 * Service worker: the app shell works offline, the API never comes from a
 * cache (the app keeps its own last answers, with their time).
 * __PRECACHE__ and __VERSION__ are filled in at build time (vite.config.ts).
 */
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = "pile-" + __VERSION__;

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["/", ...__PRECACHE__.filter((p) => p !== "/index.html")]))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pile-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== sw.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    // Network first for the page, so a deploy shows up at once; offline, the cached shell.
    event.respondWith(
      fetch(req).catch(async () => (await caches.match("/", { cacheName: CACHE, ignoreVary: true })) ?? Response.error()),
    );
    return;
  }
  // Hashed assets, fonts, icons: cache first. ignoreVary: servers send
  // "Vary: Origin", and crossorigin scripts/fonts carry an Origin header the
  // precached copy lacks; the files are versioned, so Vary adds nothing here.
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreVary: true }).then((hit) => hit ?? fetch(req)));
});
