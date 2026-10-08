// Raksa — jendela kode captcha untuk Robot 1.
// Saat Robot 1 (server GitHub) perlu login ke BigSeller, BigSeller meminta kode
// gambar. Robot mengirim gambarnya ke sini; Owner/Admin yang sedang membuka Raksa
// mengetik kodenya, lalu robot melanjutkan. Robot tidak pernah mengisi captcha sendiri.
(function () {
  var tampil = null;

  function css() {
    if (document.getElementById("rc-css")) return;
    var s = document.createElement("style");
    s.id = "rc-css";
    s.textContent =
      "#rc-wrap{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px}" +
      "#rc-box{background:rgb(var(--surface));color:rgb(var(--n-900));border-radius:16px;max-width:380px;width:100%;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.35);font-family:inherit}" +
      "#rc-box h3{margin:0 0 4px;font-size:16px;font-weight:700}#rc-box p{margin:0 0 12px;font-size:13px;color:rgb(var(--n-600))}" +
      "#rc-box img{display:block;max-width:100%;margin:0 auto 12px;border-radius:8px;border:1px solid rgb(var(--n-200));background:#fff}" +
      "#rc-box input{width:100%;height:44px;border-radius:10px;border:1px solid rgb(var(--n-200));background:rgb(var(--surface));color:rgb(var(--n-900));padding:0 12px;font-size:18px;letter-spacing:.1em;font-family:inherit}" +
      "#rc-box .rc-btn{display:flex;gap:8px;margin-top:12px}#rc-box button{flex:1;height:42px;border-radius:10px;border:0;font-weight:700;font-family:inherit;cursor:pointer}" +
      "#rc-kirim{background:rgb(var(--brand-700));color:#fff}#rc-nanti{background:transparent;color:rgb(var(--n-700));border:1px solid rgb(var(--n-200))!important}";
    document.head.appendChild(s);
  }

  function tutup() {
    var w = document.getElementById("rc-wrap");
    if (w) w.remove();
    tampil = null;
  }

  function buka(R, run) {
    if (tampil === run.id + run.captcha_minta) return;
    tutup();
    css();
    tampil = run.id + run.captcha_minta;
    var w = document.createElement("div");
    w.id = "rc-wrap";
    w.innerHTML =
      '<div id="rc-box" role="dialog" aria-modal="true"><h3>Robot BigSeller butuh kode captcha</h3>' +
      "<p>Robot sedang login ke BigSeller. Ketik kode pada gambar di bawah supaya robot bisa lanjut bekerja.</p>" +
      '<img alt="Kode captcha BigSeller" src="' + run.captcha_img + '">' +
      '<input id="rc-kode" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Kode pada gambar">' +
      '<div class="rc-btn"><button id="rc-nanti" type="button">Nanti</button><button id="rc-kirim" type="button">Kirim ke robot</button></div></div>';
    document.body.appendChild(w);
    var inp = document.getElementById("rc-kode");
    inp.focus();
    function kirim() {
      var v = inp.value.trim();
      if (!v) return inp.focus();
      var b = document.getElementById("rc-kirim");
      b.disabled = true;
      b.textContent = "Mengirim…";
      R.sb.from("robot_run").update({ captcha_jawab: v }).eq("id", run.id).then(function (r) {
        if (r.error) { b.disabled = false; b.textContent = "Kirim ke robot"; alert("Gagal mengirim: " + r.error.message); return; }
        tutup();
      });
    }
    document.getElementById("rc-kirim").onclick = kirim;
    inp.onkeydown = function (e) { if (e.key === "Enter") kirim(); };
    document.getElementById("rc-nanti").onclick = tutup;
  }

  function cek(R) {
    R.sb.from("robot_run").select("id,captcha_img,captcha_jawab,captcha_minta,status")
      .eq("status", "BERJALAN").not("captcha_img", "is", null).is("captcha_jawab", null)
      .order("mulai", { ascending: false }).limit(1)
      .then(function (r) {
        var run = r.data && r.data[0];
        if (run && run.captcha_minta && Date.now() - new Date(run.captcha_minta).getTime() < 10 * 60000) buka(R, run);
        else if (tampil) tutup();
      });
  }

  function mulai() {
    var R = window.__RAKSA;
    if (!R || !R.sb || !R.profil) return setTimeout(mulai, 1500);
    if (R.profil.akses !== "OWNER" && R.profil.akses !== "ADMIN") return;
    cek(R);
    R.sb.channel("raksa-captcha")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "robot_run" }, function () { cek(R); })
      .subscribe();
    setInterval(function () { cek(R); }, 20000);
  }
  mulai();
})();
