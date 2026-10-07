// Service worker Raksa: membuat aplikasi bisa dipasang (PWA) dan tetap terbuka
// saat internet putus sebentar. Data selalu diambil dari server; yang disimpan
// di sini hanya file aplikasinya.
const CACHE = "raksa-1.0.2610071400";
const INTI = ["/", "/boot.js?v=1.0.2610071400", "/app.js?v=1.0.2610071400", "/raksa.css?v=1.0.2610071400", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(INTI)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // Halaman: coba internet dulu supaya versi terbaru langsung terpakai.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok) { const salin = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, salin)); }
    return res;
  })));
});
