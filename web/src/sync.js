// Lapisan data Raksa 1.0
// ---------------------------------------------------------------------------
// Aplikasi Raksa menyimpan seluruh datanya dalam satu objek `db` (sama seperti
// prototype). Modul ini:
//   1. memuat `db` dari Supabase (+ cache IndexedDB supaya pembukaan berikutnya cepat),
//   2. menyimpan setiap perubahan sebagai baris per dokumen (bukan satu blob besar),
//   3. menerima perubahan dari pengguna lain secara langsung (realtime),
//   4. menyimpan hasil hitung denda supaya karyawan bisa melihat dendanya sendiri.

import { idbGet, idbSet, idbDel } from "./idb.js";

// Cara setiap kunci di `db` disimpan.
const MAP = new Set(["orders", "kombinasi", "skus", "dendaMeta", "rakMap"]);
const LIST = new Set(["cases", "movements", "exportBatches", "uploads"]);
const APPEND = new Set(["history"]);          // riwayat status pesanan (tidak pernah diubah)
const LEWATI = new Set(["audit"]);            // audit punya tabelnya sendiri
const TANPA_CEK_DALAM = new Set(["orders", "history"]); // koleksi besar: cukup cek identitas objek

export const JENDELA_HARI = 120;              // pesanan & riwayat yang dimuat ke aplikasi
const CACHE_VERSI = 3;

const kunciHistory = (h) => `${h.nomor}|${h.waktu}|${h.baru}`;
// JSON dengan urutan kunci tetap (jsonb di Postgres mengubah urutan kunci).
const stabil = (v) => {
  if (Array.isArray(v)) return "[" + v.map(stabil).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ":" + stabil(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
};
const tglDok = (koleksi, data) => {
  if (koleksi === "orders") return data.dibuat || data.pertamaTerlihat || null;
  if (koleksi === "history") return data.waktu || null;
  return null;
};

export function buatSync({ sb, user, profil, onStatus, onRemote, onDendaSaya }) {
  const akses = profil.akses;
  const cacheKey = `raksa:${user.id}:v${CACHE_VERSI}`;
  const owner = akses === "OWNER";
  const bolehTulisSemua = akses === "OWNER" || akses === "ADMIN";

  // Snapshot terakhir yang sudah sama dengan server: koleksi -> Map(id -> objek)
  const last = new Map();
  const lastJson = new WeakMap();            // objek -> JSON (cek perubahan "dalam")
  const pending = new Map();                 // "koleksi\u0000id" -> baris siap kirim
  const tulisanSaya = new Map();             // kunci -> JSON data yang baru saja ditulis (penyaring gema realtime)
  let auditHead = null;
  let watermark = null;
  let dendaLast = new Map();                 // id -> JSON
  let mengirim = false;
  let gagalBeruntun = 0;
  let timerKirim = null;
  let dbSekarang = null;

  const status = (s) => onStatus && onStatus({ ...s, antre: pending.size });

  const kunci = (k, id) => k + "\u0000" + id;
  const json = (o) => {
    if (o && typeof o === "object") {
      let j = lastJson.get(o);
      if (j === undefined) { j = JSON.stringify(o); lastJson.set(o, j); }
      return j;
    }
    return JSON.stringify(o);
  };

  // ---------------------------------------------------------------- pecah db -> dokumen
  function entriKoleksi(nama, nilai) {
    if (MAP.has(nama)) return Object.entries(nilai || {});
    if (LIST.has(nama)) return (nilai || []).filter((x) => x && x.id != null).map((x) => [String(x.id), x]);
    if (APPEND.has(nama)) return (nilai || []).map((x) => [kunciHistory(x), x]);
    return null;
  }

  function pisahModal(id, sku) {
    // Harga modal disimpan terpisah (koleksi skuModal) yang hanya bisa dibaca Owner.
    if (!sku || typeof sku !== "object" || !("modal" in sku)) return [sku, undefined];
    const { modal, ...sisa } = sku;
    return [sisa, modal];
  }

  function antrekan(koleksi, id, data, hapus = false) {
    const row = {
      koleksi, id, data: hapus ? {} : data, dihapus: hapus,
      tgl: hapus ? null : tglDok(koleksi, data),
    };
    pending.set(kunci(koleksi, id), row);
    if (!hapus) tulisanSaya.set(kunci(koleksi, id), stabil(data));
  }

  function antrekanSku(id, sku, hapus) {
    if (hapus) { antrekan("skus", id, null, true); return; }
    const [tanpaModal, modal] = pisahModal(id, sku);
    antrekan("skus", id, tanpaModal);
    if (modal !== undefined && bolehTulisSemua) antrekan("skuModal", id, { modal });
  }

  // Bandingkan db baru dengan snapshot terakhir, antrekan yang berubah.
  function bandingkan(db) {
    for (const nama of Object.keys(db)) {
      if (nama.startsWith("__") || LEWATI.has(nama)) continue;
      const nilai = db[nama];
      const entri = entriKoleksi(nama, nilai);
      if (!entri) {
        // koleksi tunggal
        const lama = last.get("_tunggal")?.get(nama);
        if (lama === nilai) continue;
        if (lama !== undefined && json(lama) === json(nilai)) {
          last.get("_tunggal").set(nama, nilai);
          continue;
        }
        if (!last.has("_tunggal")) last.set("_tunggal", new Map());
        last.get("_tunggal").set(nama, nilai);
        antrekan("_tunggal", nama, { v: nilai });
        continue;
      }
      let peta = last.get(nama);
      if (!peta) { peta = new Map(); last.set(nama, peta); }
      const terlihat = new Set();
      const cekDalam = !TANPA_CEK_DALAM.has(nama);
      for (const [id, obj] of entri) {
        terlihat.add(id);
        const lama = peta.get(id);
        if (lama === obj) continue;
        if (lama !== undefined && (APPEND.has(nama) || (cekDalam && json(lama) === json(obj)))) {
          peta.set(id, obj);
          continue;
        }
        peta.set(id, obj);
        if (nama === "skus") antrekanSku(id, obj, false);
        else antrekan(nama, id, obj);
      }
      if (!APPEND.has(nama)) {
        for (const id of [...peta.keys()]) {
          if (!terlihat.has(id)) {
            peta.delete(id);
            if (nama === "orders") continue;     // pesanan di luar jendela muat tidak dihapus
            if (nama === "skus") antrekanSku(id, null, true);
            else antrekan(nama, id, null, true);
          }
        }
      }
    }
    // Audit: entri baru ada di depan array
    if (Array.isArray(db.audit) && db.audit.length) {
      const baru = [];
      for (const a of db.audit) {
        if (a === auditHead) break;
        baru.push(a);
        if (baru.length > 50) break;
      }
      if (auditHead !== null && baru.length) {
        sb.from("audit_log").insert(baru.reverse().map((a) => ({
          waktu: a.waktu, oleh: a.oleh, aksi: String(a.aksi).slice(0, 2000),
        }))).then(() => {});
      }
      auditHead = db.audit[0];
    }
  }

  // ---------------------------------------------------------------- kirim antrean
  async function kirim() {
    if (mengirim || !pending.size) return;
    mengirim = true;
    status({ fase: "menyimpan" });
    try {
      while (pending.size) {
        const batch = [...pending.entries()].slice(0, 400);
        const rows = batch.map(([, r]) => r);
        const { error } = await sb.from("dokumen").upsert(rows, { onConflict: "koleksi,id" });
        if (error) throw error;
        for (const [k, r] of batch) if (pending.get(k) === r) pending.delete(k);
        await simpanCacheNanti();
      }
      gagalBeruntun = 0;
      status({ fase: "tersimpan" });
    } catch (e) {
      gagalBeruntun++;
      console.warn("[raksa] gagal menyimpan", e);
      const izin = /row-level security|permission/i.test(e?.message || "");
      if (izin) {
        // Baris yang memang tidak boleh ditulis peran ini dibuang supaya antrean tidak macet.
        for (const [k, r] of [...pending.entries()]) if (!bolehTulisKoleksi(r)) pending.delete(k);
      }
      status({ fase: navigator.onLine ? "gagal" : "offline", pesan: e?.message });
      const jeda = Math.min(60000, 2000 * 2 ** Math.min(gagalBeruntun, 5));
      clearTimeout(timerKirim);
      timerKirim = setTimeout(kirim, jeda);
    } finally {
      mengirim = false;
    }
    if (pending.size && !timerKirim) jadwalKirim();
  }
  function bolehTulisKoleksi(r) {
    if (bolehTulisSemua) return true;
    return (r.koleksi === "cases" && r.data?.jenis === "PENDING") || r.koleksi === "dendaMeta";
  }
  function jadwalKirim(ms = 300) {
    clearTimeout(timerKirim);
    timerKirim = setTimeout(() => { timerKirim = null; kirim(); }, ms);
  }
  window.addEventListener("online", () => jadwalKirim(50));

  // Dipanggil aplikasi setiap kali db berubah (sudah di-debounce oleh aplikasi).
  function simpan(db) {
    dbSekarang = db;
    bandingkan(db);
    if (pending.size) jadwalKirim();
    else simpanCacheNanti();
  }

  // ---------------------------------------------------------------- cache IndexedDB
  let timerCache = null;
  function simpanCacheNanti() {
    clearTimeout(timerCache);
    timerCache = setTimeout(simpanCache, 4000);
  }
  async function simpanCache() {
    if (!dbSekarang) return;
    try {
      const { audit, ...isi } = dbSekarang;
      const tanpaPrivat = Object.fromEntries(Object.entries(isi).filter(([k]) => !k.startsWith("__")));
      await idbSet(cacheKey, {
        watermark, db: tanpaPrivat, pending: [...pending.values()],
        dendaLast: [...dendaLast.entries()], disimpan: Date.now(),
      });
    } catch (e) { console.warn("[raksa] cache gagal", e); }
  }

  // ---------------------------------------------------------------- muat dari server
  const batasJendela = () => new Date(Date.now() - JENDELA_HARI * 864e5).toISOString();

  async function ambilSemua(buatQuery, label, onProgres) {
    const ukuran = 1000;
    const { count, error: e0 } = await buatQuery(true);
    if (e0) throw e0;
    const total = count || 0;
    const hasil = [];
    let selesai = 0;
    const halaman = [];
    for (let i = 0; i < total; i += ukuran) halaman.push(i);
    const pekerja = async () => {
      while (halaman.length) {
        const dari = halaman.shift();
        const { data, error } = await buatQuery(false).range(dari, dari + ukuran - 1);
        if (error) throw error;
        hasil.push(...data);
        selesai += data.length;
        onProgres && onProgres(label, selesai, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, halaman.length || 1) }, pekerja));
    return hasil;
  }

  function terapkanBaris(db, rows, { modal } = {}) {
    for (const r of rows) {
      const k = r.koleksi;
      if (k === "skuModal") {
        if (!r.dihapus && db.skus?.[r.id]) db.skus[r.id] = { ...db.skus[r.id], modal: r.data.modal };
        else if (!r.dihapus) (modal || (modal = {}))[r.id] = r.data.modal;
        continue;
      }
      if (k === "_tunggal") {
        if (!r.dihapus) db[r.id] = r.data.v;
        continue;
      }
      if (MAP.has(k)) {
        db[k] = db[k] || {};
        if (r.dihapus) delete db[k][r.id];
        else db[k][r.id] = k === "skus" && db[k][r.id] && "modal" in db[k][r.id]
          ? { ...r.data, modal: db[k][r.id].modal } : r.data;
      } else if (LIST.has(k) || APPEND.has(k)) {
        db["__idx_" + k] = db["__idx_" + k] || new Map((db[k] || []).map((x, i) => [APPEND.has(k) ? kunciHistory(x) : String(x.id), i]));
        db[k] = db[k] || [];
        const idx = db["__idx_" + k];
        const i = idx.get(r.id);
        if (r.dihapus) {
          if (i !== undefined) { db[k][i] = null; idx.delete(r.id); }
        } else if (i !== undefined) db[k][i] = r.data;
        else { idx.set(r.id, db[k].length); db[k].push(r.data); }
      }
    }
    for (const k of Object.keys(db)) {
      if (k.startsWith("__idx_")) {
        const nama = k.slice(6);
        db[nama] = db[nama].filter(Boolean);
        delete db[k];
      }
    }
    if (modal && db.skus) for (const [id, m] of Object.entries(modal)) if (db.skus[id]) db.skus[id] = { ...db.skus[id], modal: m };
    return db;
  }

  function urutkan(db) {
    // Prototype menyimpan kasus/pergerakan berurutan; jaga urutan berdasarkan id/waktu.
    const angka = (id) => parseInt(String(id).split("-")[1]) || 0;
    if (db.cases) db.cases.sort((a, b) => angka(a.id) - angka(b.id) || String(a.id).localeCompare(String(b.id)));
    if (db.movements) db.movements.sort((a, b) => angka(a.id) - angka(b.id) || String(a.id).localeCompare(String(b.id)));
    if (db.uploads) db.uploads.sort((a, b) => String(a.waktu).localeCompare(String(b.waktu)));
    if (db.exportBatches) db.exportBatches.sort((a, b) => String(a.waktu).localeCompare(String(b.waktu)));
    if (db.history) db.history.sort((a, b) => String(a.waktu).localeCompare(String(b.waktu)));
    return db;
  }

  function pangkasJendela(db) {
    // Pesanan lama yang tidak terkait kasus dibuang dari memori aplikasi (tetap ada di server).
    const batas = batasJendela();
    const terkait = new Set((db.cases || []).map((c) => c.nomor).filter(Boolean));
    if (db.orders) {
      for (const [n, o] of Object.entries(db.orders)) {
        const t = o.dibuat || o.pertamaTerlihat;
        if (t && t < batas && !terkait.has(n)) delete db.orders[n];
      }
    }
    if (db.history) db.history = db.history.filter((h) => !h.waktu || h.waktu >= batas || terkait.has(h.nomor));
  }

  async function muat(onProgres) {
    let cache = null;
    try { cache = await idbGet(cacheKey); } catch {}
    const mulai = new Date().toISOString();
    let db;
    let rowsDelta = [];
    if (cache && cache.watermark && Date.now() - (cache.disimpan || 0) < 30 * 864e5) {
      db = cache.db;
      for (const r of cache.pending || []) pending.set(kunci(r.koleksi, r.id), r);
      dendaLast = new Map(cache.dendaLast || []);
      const sejak = new Date(new Date(cache.watermark).getTime() - 120000).toISOString();
      onProgres && onProgres("Memeriksa perubahan terbaru", 0, 0);
      rowsDelta = await ambilSemua(
        (head) => sb.from("dokumen")
          .select(head ? "id" : "koleksi,id,data,dihapus,diubah_pada", head ? { count: "exact", head: true } : undefined)
          .gt("diubah_pada", sejak).order("diubah_pada"),
        "Perubahan terbaru", onProgres);
      terapkanBaris(db, rowsDelta);
    } else {
      db = {};
      const batas = batasJendela();
      const rows = await ambilSemua(
        (head) => sb.from("dokumen")
          .select(head ? "id" : "koleksi,id,data,dihapus,diubah_pada", head ? { count: "exact", head: true } : undefined)
          .eq("dihapus", false)
          .or(`koleksi.not.in.(orders,history),tgl.gte.${batas},tgl.is.null`)
          .order("koleksi").order("id"),
        "Memuat data", onProgres);
      terapkanBaris(db, rows);
      // Pesanan lama yang terkait kasus
      const ada = new Set(Object.keys(db.orders || {}));
      const perlu = [...new Set((db.cases || []).map((c) => c.nomor).filter((n) => n && !ada.has(n)))];
      for (let i = 0; i < perlu.length; i += 150) {
        const potong = perlu.slice(i, i + 150);
        const { data } = await sb.from("dokumen").select("koleksi,id,data,dihapus")
          .eq("koleksi", "orders").eq("dihapus", false).in("id", potong);
        if (data) terapkanBaris(db, data);
      }
    }
    watermark = mulai;
    pangkasJendela(db);
    urutkan(db);

    // Audit (Owner/Admin): 300 terakhir
    db.audit = [];
    if (bolehTulisSemua) {
      const { data } = await sb.from("audit_log").select("waktu,oleh,aksi").order("waktu", { ascending: false }).limit(300);
      db.audit = (data || []).map((a) => ({ waktu: a.waktu, oleh: a.oleh, aksi: a.aksi }));
    }
    auditHead = db.audit[0] || null;
    if (!db.audit.length) auditHead = undefined; // penanda: belum ada audit, entri pertama tetap dikirim

    // Denda saya (karyawan / admin)
    if (!owner) await muatDendaSaya();

    // snapshot awal = isi db (yang sudah sama dengan server)
    isiSnapshot(db);
    dbSekarang = db;
    if (pending.size) jadwalKirim(500);
    simpanCacheNanti();
    return db;
  }

  function isiSnapshot(db) {
    last.clear();
    for (const nama of Object.keys(db)) {
      if (nama.startsWith("__") || LEWATI.has(nama)) continue;
      const entri = entriKoleksi(nama, db[nama]);
      if (!entri) {
        if (!last.has("_tunggal")) last.set("_tunggal", new Map());
        last.get("_tunggal").set(nama, db[nama]);
      } else last.set(nama, new Map(entri));
    }
    // Baris yang masih menunggu dikirim: biarkan snapshot memakai nilai lama
    // supaya tidak ikut dianggap "berubah" lagi.
  }

  async function muatDendaSaya() {
    const { data } = await sb.from("denda_hitung").select("id,data,dihapus")
      .eq("orang", profil.nama).eq("dihapus", false);
    const list = (data || []).map((r) => r.data);
    window.__RAKSA && (window.__RAKSA.dendaSaya = list);
    onDendaSaya && onDendaSaya(list);
    return list;
  }

  // ---------------------------------------------------------------- denda hasil hitung
  let timerDenda = null;
  function simpanDenda(list) {
    if (!bolehTulisSemua || !Array.isArray(list)) return;
    clearTimeout(timerDenda);
    timerDenda = setTimeout(async () => {
      const now = new Map();
      const rows = [];
      for (const d of list) {
        const j = JSON.stringify(d);
        now.set(d.id, j);
        if (dendaLast.get(d.id) !== j) rows.push({ id: d.id, orang: d.orang || "-", data: d, dihapus: false });
      }
      for (const [id] of dendaLast) if (!now.has(id)) rows.push({ id, orang: "-", data: {}, dihapus: true });
      if (!rows.length) return;
      for (let i = 0; i < rows.length; i += 400) {
        const { error } = await sb.from("denda_hitung").upsert(rows.slice(i, i + 400), { onConflict: "id" });
        if (error) { console.warn("[raksa] denda gagal disimpan", error); return; }
      }
      dendaLast = now;
      simpanCacheNanti();
    }, 1500);
  }

  // ---------------------------------------------------------------- realtime
  let antrianRemote = [];
  let timerRemote = null;
  function terimaRemote(row) {
    if (!row || !row.koleksi) return;
    const k = kunci(row.koleksi, row.id);
    if (pending.has(k)) return;                       // perubahan lokal kita lebih baru
    const j = tulisanSaya.get(k);
    if (j !== undefined && !row.dihapus && stabil(row.data) === j) { tulisanSaya.delete(k); return; }
    antrianRemote.push(row);
    clearTimeout(timerRemote);
    timerRemote = setTimeout(terapkanRemote, 400);
  }
  function terapkanRemote() {
    const rows = antrianRemote;
    antrianRemote = [];
    if (!rows.length || !onRemote) return;
    onRemote((db) => {
      const baru = { ...db };
      for (const nama of new Set(rows.map((r) => r.koleksi === "_tunggal" ? r.id : r.koleksi === "skuModal" ? "skus" : r.koleksi))) {
        const v = baru[nama];
        baru[nama] = Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...v } : v;
      }
      terapkanBaris(baru, rows);
      urutkan(baru);
      // perbarui snapshot supaya data dari server tidak dikirim balik
      for (const r of rows) {
        const nama = r.koleksi === "_tunggal" ? null : r.koleksi === "skuModal" ? "skus" : r.koleksi;
        if (nama === null) {
          if (!last.has("_tunggal")) last.set("_tunggal", new Map());
          last.get("_tunggal").set(r.id, baru[r.id]);
          continue;
        }
        if (!last.has(nama)) last.set(nama, new Map());
        const peta = last.get(nama);
        if (r.dihapus && r.koleksi !== "skuModal") peta.delete(r.id);
        else {
          const obj = MAP.has(nama) ? baru[nama]?.[r.id]
            : (baru[nama] || []).find((x) => (APPEND.has(nama) ? kunciHistory(x) : String(x.id)) === r.id);
          if (obj) peta.set(r.id, obj);
        }
      }
      dbSekarang = baru;
      simpanCacheNanti();
      return baru;
    });
  }

  let saluran = null;
  function mulaiRealtime({ onRobot } = {}) {
    saluran = sb.channel("raksa-db")
      .on("postgres_changes", { event: "*", schema: "public", table: "dokumen" }, (p) => terimaRemote(p.new))
      .on("postgres_changes", { event: "*", schema: "public", table: "robot_run" }, (p) => onRobot && onRobot(p.new))
      .subscribe((s) => {
        if (s === "SUBSCRIBED") status({ fase: "tersambung" });
      });
    // Setelah koneksi pulih / aplikasi dibuka lagi: ambil perubahan yang terlewat.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") ambilDelta();
    });
    window.addEventListener("online", ambilDelta);
    setInterval(ambilDelta, 5 * 60 * 1000);
  }

  let sedangDelta = false;
  async function ambilDelta() {
    if (sedangDelta || !watermark) return;
    sedangDelta = true;
    try {
      const mulai = new Date().toISOString();
      const sejak = new Date(new Date(watermark).getTime() - 120000).toISOString();
      const rows = await ambilSemua(
        (head) => sb.from("dokumen")
          .select(head ? "id" : "koleksi,id,data,dihapus,diubah_pada", head ? { count: "exact", head: true } : undefined)
          .gt("diubah_pada", sejak).order("diubah_pada"),
        "delta");
      rows.forEach(terimaRemote);
      watermark = mulai;
      if (!owner) muatDendaSaya();
    } catch (e) {
      console.warn("[raksa] delta gagal", e);
    } finally {
      sedangDelta = false;
    }
  }

  // ---------------------------------------------------------------- cari pesanan lama di server
  async function cariPesanan(q) {
    const v = String(q || "").trim();
    if (!v) return null;
    let { data } = await sb.from("dokumen").select("koleksi,id,data,dihapus")
      .eq("koleksi", "orders").eq("dihapus", false).eq("id", v).limit(1);
    if (!data?.length) {
      ({ data } = await sb.from("dokumen").select("koleksi,id,data,dihapus")
        .eq("koleksi", "orders").eq("dihapus", false).eq("data->>resi", v).limit(1));
    }
    if (!data?.length) return null;
    terimaRemote({ ...data[0], _paksa: true });
    clearTimeout(timerRemote);
    terapkanRemote();
    return data[0].id;
  }

  async function hapusCache() { try { await idbDel(cacheKey); } catch {} }

  return {
    muat, simpan, simpanDenda, mulaiRealtime, ambilDelta, cariPesanan, hapusCache,
    antre: () => pending.size,
    kirimSekarang: () => kirim(),
  };
}
