// Raksa — beri tahu kalau ada versi baru, supaya aplikasi yang lama terbuka (HP/PWA) dimuat ulang.
(function () {
  var tag = document.querySelector('script[src*="boot.js?v="]');
  var VERSI = tag ? (tag.getAttribute("src").split("v=")[1] || "") : "";
  var sudah = false;
  function cek() {
    if (sudah || !VERSI || document.visibilityState === "hidden") return;
    fetch("/index.html?cek=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (t) {
        var m = t.match(/boot\.js\?v=([^"']+)/);
        if (!m || m[1] === VERSI || sudah) return;
        sudah = true;
        try { navigator.serviceWorker.getRegistration().then(function (g) { g && g.update(); }); } catch (e) {}
        var d = document.createElement("div");
        d.id = "raksa-versi";
        d.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9998;display:flex;gap:12px;align-items:center;" +
          "background:#0b3f31;color:#fff;padding:10px 12px 10px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);" +
          "font:600 13.5px/1.3 inherit;max-width:calc(100vw - 32px)";
        d.innerHTML = '<span>Versi baru Raksa tersedia.</span><button type="button" style="border:0;border-radius:8px;padding:7px 12px;font:700 13px inherit;cursor:pointer;background:#fff;color:#093328">Muat ulang</button>';
        d.querySelector("button").onclick = function () { location.reload(); };
        document.body.appendChild(d);
      })
      .catch(function () {});
  }
  setInterval(cek, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") cek(); });
  setTimeout(cek, 30000);
})();
