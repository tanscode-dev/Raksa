/* Kolom tanggal selalu dd/mm/yyyy (apa pun bahasa browser) — 19 Nov 2026.
   Setiap <input type="date"> disembunyikan dan diganti kotak teks dd/mm/yyyy + tombol kalender.
   Nilai asli (yyyy-mm-dd) tetap di input aslinya dan event input/change dikirim ke sana,
   jadi kode aplikasi (termasuk React) tidak perlu diubah. */
(function () {
  if (window.__tglDmy) return; window.__tglDmy = true;
  var setNilai = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  function keDmy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  function keIso(s) {
    var m = /^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2}|\d{4})$/.exec(String(s || "").trim());
    if (!m) return "";
    var d = +m[1], mo = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "";
    return y + "-" + (mo < 10 ? "0" : "") + mo + "-" + (d < 10 ? "0" : "") + d;
  }
  function garis(raw, prev) {
    if (raw.length < prev.length) return raw;
    if (!raw.split("").every(function (c, i) { return /\d/.test(c) || (c === "/" && (i === 2 || i === 5)); })) return raw.slice(0, 10);
    var g = raw.replace(/\D/g, "").slice(0, 8), o = g.slice(0, 2);
    if (g.length > 2) o += "/" + g.slice(2, 4);
    if (g.length > 4) o += "/" + g.slice(4, 8);
    if (g.length === 2 || g.length === 4) o += "/";
    return o;
  }
  function kirim(asli, iso) {
    if (asli.value === iso) return;
    setNilai.call(asli, iso);
    asli.dispatchEvent(new Event("input", { bubbles: true }));
    asli.dispatchEvent(new Event("change", { bubbles: true }));
  }
  var daftar = [];
  function pasang(asli) {
    if (asli.__dmy || asli.type !== "date" || asli.closest("[data-tgl-asli]") || asli.getAttribute("aria-hidden") === "true" || asli.tabIndex === -1) return;
    var bungkus = document.createElement("span");
    bungkus.className = "tgl-dmy";
    bungkus.style.cssText = "position:relative;display:inline-flex;align-items:center;max-width:100%;" + (asli.style.width ? "width:" + asli.style.width + ";" : "");
    var teks = document.createElement("input");
    teks.type = "text"; teks.inputMode = "numeric"; teks.autocomplete = "off"; teks.placeholder = "dd/mm/yyyy";
    teks.className = asli.className; teks.style.cssText = asli.style.cssText; teks.style.paddingRight = "28px"; teks.style.width = "100%";
    teks.disabled = asli.disabled; teks.readOnly = asli.readOnly; teks.title = "Format tanggal: dd/mm/yyyy";
    if (asli.getAttribute("aria-label")) teks.setAttribute("aria-label", asli.getAttribute("aria-label"));
    teks.value = keDmy(asli.value);
    var tombol = document.createElement("button");
    tombol.type = "button"; tombol.tabIndex = -1; tombol.setAttribute("aria-label", "Pilih dari kalender"); tombol.textContent = "📅";
    tombol.style.cssText = "position:absolute;right:4px;top:50%;transform:translateY(-50%);border:0;background:none;cursor:pointer;font-size:13px;padding:2px;line-height:1;opacity:.7";
    asli.__dmy = { teks: teks, bungkus: bungkus, akhir: asli.value };
    asli.style.position = "absolute"; asli.style.opacity = "0"; asli.style.pointerEvents = "none"; asli.style.width = "1px"; asli.style.height = "1px";
    asli.style.right = "0"; asli.style.bottom = "0"; asli.tabIndex = -1; asli.setAttribute("aria-hidden", "true");
    asli.parentNode.insertBefore(bungkus, asli);
    bungkus.appendChild(teks); bungkus.appendChild(tombol);
    teks.addEventListener("input", function () {
      var v = garis(teks.value, teks.__prev || ""); teks.value = v; teks.__prev = v;
      var iso = keIso(v);
      teks.style.borderColor = "";
      if (iso || v === "") { asli.__dmy.akhir = iso; kirim(asli, iso); }
    });
    teks.addEventListener("blur", function () { var v = teks.value; teks.style.borderColor = v && !keIso(v) ? "#d33" : ""; });
    teks.addEventListener("keydown", function (e) { if (e.key === "Enter" && asli.form) { var iso = keIso(teks.value); if (iso) kirim(asli, iso); } });
    tombol.addEventListener("click", function () {
      if (teks.disabled || teks.readOnly) return;
      try { asli.showPicker(); } catch (e) { asli.focus(); asli.click(); }
    });
    asli.addEventListener("change", function () { if (asli.value !== keIso(teks.value)) { teks.value = keDmy(asli.value); teks.__prev = teks.value; } asli.__dmy.akhir = asli.value; });
    daftar.push(asli);
  }
  function pindai(akar) { (akar.querySelectorAll ? akar.querySelectorAll('input[type="date"]') : []).forEach(pasang); }
  function sinkron() {
    daftar = daftar.filter(function (a) {
      var d = a.__dmy;
      if (!a.isConnected) { if (d && d.bungkus.isConnected) d.bungkus.remove(); return false; }
      if (d.bungkus.parentNode !== a.parentNode || d.bungkus.nextSibling !== a) { try { a.parentNode.insertBefore(d.bungkus, a); } catch (e) {} }
      if (a.value !== d.akhir) { d.akhir = a.value; if (document.activeElement !== d.teks) { d.teks.value = keDmy(a.value); d.teks.__prev = d.teks.value; } }
      d.teks.disabled = a.disabled;
      return true;
    });
  }
  function mulai() {
    pindai(document);
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) {
        var n = ms[i].addedNodes[j];
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches('input[type="date"]')) pasang(n); else pindai(n);
      }
      sinkron();
    }).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(sinkron, 400);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mulai); else mulai();
})();
