// Raksa 1.0 — pembuka aplikasi: login, muat data, lalu menjalankan aplikasi Raksa.
import { createClient } from "@supabase/supabase-js";
import { buatSync } from "./sync.js";

const SUPABASE_URL = __SUPABASE_URL__;
const SUPABASE_KEY = __SUPABASE_KEY__;
const GITHUB_ACTIONS = __GITHUB_ACTIONS__;
const DOMAIN = "raksa.invalid";
const VERSI = __VERSI__;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "raksa-auth" },
  realtime: { params: { eventsPerSecond: 20 } },
});

// ---------------------------------------------------------------- shim lingkungan
// Prototype memakai window.storage (tema) dan window.claude (unduhan). Di versi
// produksi keduanya diganti: tema di localStorage, unduhan langsung lewat browser.
window.storage = {
  async get(k) { try { const v = localStorage.getItem("raksa-" + k); return v == null ? null : { value: v }; } catch { return null; } },
  async set(k, v) { try { localStorage.setItem("raksa-" + k, v); } catch {} },
};
window.claude = {
  async use(nama) {
    if (nama !== "downloads") return null;
    return {
      async save({ filename, data }) {
        const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
        const a = document.createElement("a");
        a.href = url; a.download = filename; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
      },
    };
  },
};
try {
  const t = localStorage.getItem("raksa-raksa-theme");
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
} catch {}

// ---------------------------------------------------------------- tampilan pembuka
const layar = document.getElementById("raksa-boot");
const LOGO = `<svg width="48" height="48" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="rb-lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fb88c"/><stop offset="1" stop-color="#0f5a46"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#rb-lg)"/><g stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none"><path d="M10 9v22M27 9v9"/><path d="M10 13h17M10 20.5h11M10 28h8"/></g><circle cx="28.5" cy="27.5" r="7" fill="#e3b04b"/><path d="M25.3 27.6l2.2 2.2 4.1-4.4" stroke="#0f2a22" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function tampil(html) {
  layar.innerHTML = `<div class="rb-wrap"><div class="rb-card"><div class="rb-head">${LOGO}<div><div class="rb-nama">Raksa</div><div class="rb-sub">Kontrol Kasus &amp; Stok</div></div></div>${html}</div><div class="rb-foot">Raksa ${VERSI}</div></div>`;
  layar.hidden = false;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function panggilAkun(isi) {
  const { data: { session } } = await sb.auth.getSession();
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/kelola-akun`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token || SUPABASE_KEY}`,
      },
      body: JSON.stringify(isi),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, ...j } : { ok: false, pesan: j.pesan || `Gagal (${r.status})` };
  } catch {
    return { ok: false, pesan: "Tidak bisa terhubung ke server. Periksa internet." };
  }
}

function formMasuk(pesan = "") {
  tampil(`
    <form id="rb-form" class="rb-form" autocomplete="on">
      <h1>Masuk</h1>
      <label>Nama pengguna<input name="u" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label>Kata sandi<input name="p" type="password" autocomplete="current-password" required></label>
      <div class="rb-err" ${pesan ? "" : "hidden"}>${esc(pesan)}</div>
      <button type="submit">Masuk</button>
      <p class="rb-hint">Lupa kata sandi? Minta Owner menggantinya di menu Akun Login.</p>
    </form>`);
  const f = document.getElementById("rb-form");
  f.u.focus();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = f.u.value.trim().toLowerCase();
    const btn = f.querySelector("button");
    btn.disabled = true; btn.textContent = "Memeriksa…";
    const { error } = await sb.auth.signInWithPassword({ email: `${u}@${DOMAIN}`, password: f.p.value });
    if (error) {
      formMasuk(/invalid|credentials/i.test(error.message) ? "Nama pengguna atau kata sandi salah." : error.message);
      return;
    }
    mulai();
  });
}

function formOwnerPertama(pesan = "") {
  tampil(`
    <form id="rb-form" class="rb-form">
      <h1>Selamat datang di Raksa 1.0</h1>
      <p class="rb-hint">Belum ada akun. Buat akun <b>Owner</b> pertama. Akun karyawan dibuat nanti dari menu Akun Login.</p>
      <label>Nama Anda (seperti di daftar karyawan)<input name="n" required placeholder="mis. TIM"></label>
      <label>Nama pengguna<input name="u" autocapitalize="none" spellcheck="false" required placeholder="huruf kecil, mis. tim"></label>
      <label>Kata sandi (min. 6 karakter)<input name="p" type="password" autocomplete="new-password" required></label>
      <label>Ulangi kata sandi<input name="p2" type="password" autocomplete="new-password" required></label>
      <div class="rb-err" ${pesan ? "" : "hidden"}>${esc(pesan)}</div>
      <button type="submit">Buat akun Owner</button>
    </form>`);
  const f = document.getElementById("rb-form");
  f.n.focus();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (f.p.value !== f.p2.value) return formOwnerPertama("Kedua kata sandi tidak sama.");
    const btn = f.querySelector("button");
    btn.disabled = true; btn.textContent = "Membuat akun…";
    const u = f.u.value.trim().toLowerCase();
    const r = await panggilAkun({ aksi: "daftar-owner", username: u, sandi: f.p.value, nama: f.n.value });
    if (!r.ok) return formOwnerPertama(r.pesan);
    const { error } = await sb.auth.signInWithPassword({ email: `${u}@${DOMAIN}`, password: f.p.value });
    if (error) return formMasuk(error.message);
    mulai();
  });
}

function layarMuat(teks, persen) {
  tampil(`<div class="rb-muat"><div class="rb-bar"><span style="width:${Math.max(4, Math.min(100, persen || 0))}%"></span></div><p>${esc(teks)}</p></div>`);
}

// ---------------------------------------------------------------- jalan
const pendengar = new Set();
const status = { fase: "tersimpan", antre: 0, robotVersi: 0 };
function ubahStatus(s) {
  Object.assign(status, s);
  pendengar.forEach((fn) => { try { fn(status); } catch {} });
}

async function mulai() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const r = await panggilAkun({ aksi: "status" });
    if (r.ok && r.adaOwner === false) return formOwnerPertama();
    return formMasuk();
  }
  layarMuat("Membuka akun…", 5);
  const { data: profil, error } = await sb.from("profil").select("user_id,username,nama,akses,aktif")
    .eq("user_id", session.user.id).maybeSingle();
  if (error || !profil || !profil.aktif) {
    await sb.auth.signOut();
    return formMasuk(error ? "Tidak bisa terhubung ke server. Coba lagi." : "Akun ini belum aktif. Hubungi Owner.");
  }

  let setDb = null;      // setter mentah React (tanpa X5) untuk perubahan dari server
  let antreRemote = [];  // perubahan yang datang sebelum aplikasi siap
  const sync = buatSync({
    sb, user: session.user, profil,
    onStatus: ubahStatus,
    onRemote: (fn) => { if (setDb) setDb(fn); else antreRemote.push(fn); },
    onDendaSaya: (list) => setDb && setDb((db) => ({ ...db, __dendaSaya: list })),
  });

  let db;
  try {
    db = await sync.muat((label, n, total) => {
      if (label === "delta") return;
      layarMuat(total ? `${label}: ${n.toLocaleString("id-ID")} dari ${total.toLocaleString("id-ID")} data` : label,
        total ? 10 + (85 * n) / total : 50);
    });
  } catch (e) {
    console.error(e);
    tampil(`<div class="rb-form"><h1>Gagal memuat data</h1><p class="rb-hint">${esc(e?.message || e)}</p><button id="rb-ulang">Coba lagi</button><button id="rb-keluar" class="rb-sek">Keluar</button></div>`);
    document.getElementById("rb-ulang").onclick = () => location.reload();
    document.getElementById("rb-keluar").onclick = keluar;
    return;
  }
  layarMuat("Menyiapkan tampilan…", 98);

  async function keluar() {
    if (sync.antre()) {
      if (!confirm(`Masih ada ${sync.antre()} perubahan yang belum terkirim ke server. Tetap keluar?`)) return;
    }
    await sb.auth.signOut();
    location.reload();
  }

  const bolehRobot = profil.akses === "OWNER" || profil.akses === "ADMIN";

  window.__RAKSA = {
    versi: VERSI,
    sb, profil, db, status,
    dendaSaya: [],
    githubActions: GITHUB_ACTIONS,
    dengar(fn) { pendengar.add(fn); return () => pendengar.delete(fn); },
    pasang(t) {
      if (setDb === t) return;
      setDb = t;
      const q = antreRemote; antreRemote = [];
      q.forEach((fn) => t(fn));
    },
    simpan: (d) => sync.simpan(d),
    simpanDenda: (list) => sync.simpanDenda(list),
    cariPesanan: (q) => sync.cariPesanan(q),
    keluar,
    async gantiSandi(baru) {
      const { error } = await sb.auth.updateUser({ password: baru });
      return error ? error.message : null;
    },
    akun: panggilAkun,
    // ---- kunci Robot 2
    kunciCache: {},
    kunci(nama) {
      return sb.rpc("ambil_kunci", { p_nama: nama, p_menit: 20 }).then(({ data, error }) => {
        const r = error ? { ok: true } : data;      // bila server tidak terjangkau, jangan menghalangi
        window.__RAKSA.kunciCache[nama] = r;
        return r;
      });
    },
    lepasKunci(nama) { sb.rpc("lepas_kunci", { p_nama: nama }).then(() => {}); },
    async cekKunci(nama) {
      const { data } = await sb.from("kunci").select("*").eq("nama", nama).maybeSingle();
      const k = data && data.sampai && new Date(data.sampai) > new Date() && data.user_id !== profil.user_id
        ? { ok: false, oleh: data.dipegang_oleh, sampai: data.sampai } : { ok: true };
      window.__RAKSA.kunciCache[nama] = k;
      return k;
    },
    // ---- Robot 1 (GitHub)
    async riwayatRobot1() {
      if (!bolehRobot) return [];
      const { data } = await sb.from("robot_run").select("*").eq("robot", "ROBOT1").order("mulai", { ascending: false }).limit(8);
      return data || [];
    },
    prosesInbox,
  };

  // muat denda saya (karyawan/admin)
  if (profil.akses !== "OWNER") {
    const { data } = await sb.from("denda_hitung").select("data").eq("orang", profil.nama).eq("dihapus", false);
    window.__RAKSA.dendaSaya = (data || []).map((r) => r.data);
  }

  // jalankan aplikasi
  const s = document.createElement("script");
  s.src = "/app.js?v=" + encodeURIComponent(VERSI);
  s.onload = () => {
    layar.hidden = true;
    layar.innerHTML = "";
    sync.mulaiRealtime({
      onRobot: (row) => {
        ubahStatus({ robotVersi: (status.robotVersi || 0) + 1 });
        if (row && row.robot === "ROBOT1" && row.status === "BERHASIL" && row.file_path && !row.diproses_oleh) prosesInbox();
      },
    });
    if (bolehRobot) {
      setTimeout(prosesInbox, 3000);
      setInterval(prosesInbox, 10 * 60 * 1000);
      window.__RAKSA.cekKunci("robot2");
      setInterval(() => window.__RAKSA.cekKunci("robot2"), 30000);
    }
  };
  s.onerror = () => tampil(`<div class="rb-form"><h1>Gagal membuka aplikasi</h1><p class="rb-hint">Periksa internet lalu muat ulang.</p></div>`);
  document.body.appendChild(s);

  window.addEventListener("beforeunload", (e) => {
    if (sync.antre()) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------------------------------------------------------------- inbox Robot 1
  let sedangInbox = false;
  async function prosesInbox(paksa) {
    if (!bolehRobot || sedangInbox) return;
    sedangInbox = true;
    try {
      const { data: runs } = await sb.from("robot_run").select("*")
        .eq("robot", "ROBOT1").eq("status", "BERHASIL").not("file_path", "is", null).is("hasil", null)
        .order("mulai").limit(5);
      for (const run of runs || []) {
        if (run.diproses_oleh && !paksa && new Date(run.diproses_pada) > new Date(Date.now() - 15 * 60000)) continue;
        const { data: dapat } = await sb.rpc("klaim_file_robot", { p_id: run.id });
        if (!dapat) continue;
        const { data: blob, error } = await sb.storage.from("robot-inbox").download(run.file_path);
        if (error || !blob) {
          await sb.from("robot_run").update({ hasil: "GAGAL: file robot tidak ditemukan di server" }).eq("id", run.id);
          continue;
        }
        const buf = await blob.arrayBuffer();
        const hasil = await new Promise((res) => {
          const tunggu = (n = 0) => {
            if (window.__rkProsesFile) {
              const batas = setTimeout(() => res({ hasil: "GAGAL", pesan: "Raksa tidak selesai memproses dalam 3 menit" }), 180000);
              window.__rkProsesFile(buf, run.file_path.split("/").pop(), run.id, (m) => {
                if (m && (m.hasil === "OK" || m.hasil === "GAGAL")) { clearTimeout(batas); res(m); }
              });
            } else if (n < 60) setTimeout(() => tunggu(n + 1), 500);
            else res({ hasil: "GAGAL", pesan: "Aplikasi belum siap" });
          };
          tunggu();
        });
        const teks = hasil.hasil === "OK"
          ? `${hasil.baru || 0} pesanan baru, ${hasil.berubah || 0} status berubah`
          : `GAGAL: ${hasil.pesan || "Raksa gagal membaca file"}`;
        await sb.from("robot_run").update({ hasil: teks }).eq("id", run.id);
        if (hasil.hasil === "OK") await sb.storage.from("robot-inbox").remove([run.file_path]);
        await sync.kirimSekarang();
        ubahStatus({ robotVersi: (status.robotVersi || 0) + 1 });
      }
    } catch (e) {
      console.warn("[raksa] inbox robot", e);
    } finally {
      sedangInbox = false;
    }
  }
}

sb.auth.onAuthStateChange((ev) => {
  if (ev === "SIGNED_OUT" && window.__RAKSA) location.reload();
});

// PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

mulai();
