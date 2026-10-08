// Service worker Raksa: membuat aplikasi bisa dipasang (PWA) dan tetap terbuka
// saat internet putus sebentar. Data selalu diambil dari server; yang disimpan
// di sini hanya file aplikasinya.
const CACHE = "raksa-1.0.2610081900";
const INTI = ["/", "/boot.js?v=1.0.2610081900", "/app.js?v=1.0.2610081900", "/raksa.css?v=1.0.2610081900", "/icon.svg", "/manifest.webmanifest"];

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
  if (e.request.method !== "GET" || u.origin !== location.origin || u.searchParams.has("cek")) return;
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

// Notifikasi pop-up (dikirim Edge Function kirim-notif, mis. saat Robot 2 gagal mengubah stok).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { isi: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.judul || "Raksa", {
    body: d.isi || "", tag: d.tag || "raksa", renotify: true, icon: "/icon-192.png", badge: "/icon-192.png",
    data: { url: d.url || "/" }, requireInteraction: /gagal|error/i.test((d.judul || "") + " " + (d.isi || "")),
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.location.origin));
    if (c) { c.focus(); return c.navigate ? c.navigate(url).catch(() => {}) : null; }
    return self.clients.openWindow(url);
  }));
});
