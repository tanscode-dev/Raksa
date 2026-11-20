// Robot 3 — Robot Shopee: ambil Laporan Penghasilan (Sudah Dilepas) dan mutasi Saldo Penjual
// dari Seller Centre Shopee lewat SATU sub akun yang bisa membuka banyak toko, lalu
// menitipkannya ke Seller Fintech (Business Manager) milik usaha pemilik sub akun.
//
// Langkah per toko (sama seperti dikerjakan manual):
//   Keuangan → Penghasilan Saya → Rincian Penghasilan → tab "Sudah Dilepas" →
//   kalender "Pilih Tanggal" → Export → tunggu → daftar laporan (ikon di samping Export) → Unduh
//   Keuangan → Saldo Saya → Transaksi → Export (bila tersedia)
//
// Robot TIDAK mengimpor sendiri: file masuk ke kartu "Robot Shopee" di Seller Fintech,
// lalu diimpor satu klik lewat layar impor yang biasa (bisa diperiksa dulu).
//
// Rahasia GitHub (diisi sendiri oleh Pemilik, tidak pernah ditampilkan):
//   BM_SUPABASE_SERVICE_KEY, SHOPEE_SUB_USER, SHOPEE_SUB_PASSWORD

import { chromium } from "playwright";
import fs from "node:fs/promises";

const URL_SB = "https://huewrdenasnocclygtwv.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY || "";
const USER = process.env.SHOPEE_SUB_USER || "";
const SANDI = process.env.SHOPEE_SUB_PASSWORD || "";
const RUN_ID = process.env.RUN_ID || "";
const MODE = process.env.MODE || "biasa";            // "biasa" | "eksplor" (hanya login & mencatat tampilan)
const LOG_URL = process.env.GITHUB_RUN_URL || null;
const SC = "https://seller.shopee.co.id";
const URL_PENGHASILAN = `${SC}/portal/finance/income`;
const URL_LOGIN = "https://accounts.shopee.co.id/seller/login?next=" + encodeURIComponent(URL_PENGHASILAN);
const SESI_BUCKET = "robot-sesi";
const SESI_PATH = "shopee-state.json";
const TUNGGU_EKSPOR = 6 * 60000;

const H = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, ...extra });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
class Gagal extends Error {}

async function sb(path, opt = {}) {
  const r = await fetch(`${URL_SB}${path}`, { ...opt, headers: H(opt.headers) });
  if (!r.ok) throw new Error(`Supabase ${opt.method || "GET"} ${path} → ${r.status} ${(await r.text()).slice(0, 300)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const ubahRun = (isi) => sb(`/rest/v1/shopee_robot_run?id=eq.${RUN_ID}`, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isi),
});
async function unggah(bucket, path, isi, tipe) {
  const r = await fetch(`${URL_SB}/storage/v1/object/${bucket}/${path}`, {
    method: "POST", headers: H({ "Content-Type": tipe, "x-upsert": "true" }), body: isi,
  });
  if (!r.ok) throw new Error(`Unggah ${path} gagal: ${r.status} ${await r.text()}`);
}
async function unduhSesi() {
  const r = await fetch(`${URL_SB}/storage/v1/object/${SESI_BUCKET}/${SESI_PATH}`, { headers: H() });
  return r.ok ? r.json() : null;
}

// ------------------------------------------------------------------ catatan langkah
const JEJAK = [];
let PAGE = null;
async function jejak(langkah, opsi = {}) {
  log("•", langkah);
  const isi = { w: new Date().toISOString(), langkah };
  if (PAGE && opsi.layar !== false) {
    const img = await PAGE.screenshot({ type: "jpeg", quality: 35 }).catch(() => null);
    if (img) isi.img = "data:image/jpeg;base64," + img.toString("base64");
    isi.url = PAGE.url();
    if (opsi.teks) isi.teks = (await PAGE.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 1500);
  }
  JEJAK.push(isi);
  // simpan maks. 14 langkah terakhir (gambar kecil) supaya mudah diperiksa
  await ubahRun({ langkah, jejak: JEJAK.slice(-14) }).catch(() => {});
}

// ------------------------------------------------------------------ tanggal (WIB)
const fmt = (s) => s.split("-").reverse().join("/");
function pecahPerBulan(dari, sampai) {
  const out = [];
  let a = new Date(dari + "T00:00:00Z");
  const z = new Date(sampai + "T00:00:00Z");
  while (a <= z) {
    const akhirBulan = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0));
    const b = akhirBulan < z ? akhirBulan : z;
    out.push([a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)]);
    a = new Date(b.getTime() + 864e5);
  }
  return out;
}
const BULAN_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// ------------------------------------------------------------------ bantu klik
const terlihat = (loc) => loc.filter({ visible: true });
async function klikTeks(page, re, { scope = page, timeout = 8000, tag = "button, a, span, div, li" } = {}) {
  const loc = terlihat(scope.locator(tag).filter({ hasText: re }));
  const n = await loc.count().catch(() => 0);
  // pilih elemen paling dalam (teks paling pendek) supaya tidak mengklik wadah besar
  let pilih = -1, pendek = 1e9;
  for (let i = 0; i < Math.min(n, 40); i++) {
    const t = ((await loc.nth(i).innerText().catch(() => "")) || "").trim();
    if (re.test(t) && t.length < pendek) { pendek = t.length; pilih = i; }
  }
  if (pilih < 0) return false;
  await loc.nth(pilih).click({ timeout }).catch(() => {});
  return true;
}
async function tutupPopup(page) {
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Escape").catch(() => {});
    const n = await page.evaluate(() => {
      const lihat = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
      let k = 0;
      for (const w of [...document.querySelectorAll(".shopee-modal, .eds-modal, [role=dialog]")].filter(lihat)) {
        if (w.querySelector("input[type=password]")) continue;          // jangan tutup permintaan password
        if (/export|ekspor|laporan/i.test(w.innerText || "")) continue;   // jangan tutup jendela export
        const t = [...w.querySelectorAll("button, i, span, a")].filter(lihat)
          .find((b) => /^(×|tutup|close|nanti|lain kali|later|ok|oke|mengerti|saya mengerti|got it|lewati|skip)$/i.test((b.innerText || b.getAttribute("aria-label") || "").trim())
            || /close/i.test(b.className || ""));
        if (t) { t.click(); k++; }
      }
      return k;
    }).catch(() => 0);
    if (!n) break;
    await page.waitForTimeout(700);
  }
}

// ------------------------------------------------------------------ OTP lewat Seller Fintech
async function tungguOtp(page, pesan) {
  const img = await page.screenshot({ type: "jpeg", quality: 50 }).catch(() => null);
  await ubahRun({ status: "MENUNGGU_OTP", otp_minta: new Date().toISOString(), otp_jawab: null, otp_pesan: pesan,
    debug_img: img ? "data:image/jpeg;base64," + img.toString("base64") : null });
  log("Menunggu kode OTP diketik di Seller Fintech");
  for (let i = 0; i < 200; i++) {                                   // ±10 menit
    await page.waitForTimeout(3000);
    const r = await sb(`/rest/v1/shopee_robot_run?id=eq.${RUN_ID}&select=otp_jawab`);
    const k = r && r[0] && r[0].otp_jawab;
    if (k) { await ubahRun({ status: "BERJALAN", otp_jawab: null, otp_pesan: null }); return String(k).trim(); }
  }
  throw new Gagal("Tidak ada yang mengisi kode OTP Shopee dalam 10 menit. Jalankan lagi dari Seller Fintech lalu isi kodenya.");
}

async function halamanLogin(page) {
  return /accounts\.shopee|\/login|signin/i.test(page.url())
    || (await terlihat(page.locator("input[name=loginKey], input[autocomplete=username]")).count().catch(() => 0)) > 0;
}

async function isiOtp(page) {
  // Shopee bisa meminta memilih cara kirim kode dulu (SMS / WhatsApp / Email)
  const kotak = () => terlihat(page.locator("input[autocomplete='one-time-code'], input[maxlength='6'], input[maxlength='1'], input[placeholder*='kode' i], input[placeholder*='code' i]"));
  if (!(await kotak().count())) {
    await klikTeks(page, /^(kirim|send).*(sms|whatsapp|wa|email)|^(sms|whatsapp|email)$|verifikasi (lewat|melalui|via)/i);
    await page.waitForTimeout(3000);
  }
  if (!(await kotak().count())) return false;
  const kode = await tungguOtp(page, "Shopee meminta kode OTP untuk login sub akun. Kode dikirim ke nomor/email sub akun.");
  const n = await kotak().count();
  if (n >= 4) { for (let i = 0; i < Math.min(n, kode.length); i++) await kotak().nth(i).fill(kode[i]); }
  else await kotak().first().fill(kode);
  await page.waitForTimeout(800);
  await klikTeks(page, /^(verifikasi|konfirmasi|lanjut|kirim|submit|ok|verify|confirm|next)$/i, { tag: "button" });
  await page.waitForTimeout(6000);
  return true;
}

async function login(page) {
  await jejak("Login sub akun Shopee");
  if (!USER || !SANDI) throw new Gagal("SHOPEE_SUB_USER / SHOPEE_SUB_PASSWORD belum diisi di GitHub Secrets repo Raksa.");
  if (!(await halamanLogin(page))) await page.goto(URL_LOGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const kolomUser = terlihat(page.locator("input[name=loginKey], input[autocomplete=username], input[type=text]")).first();
  await kolomUser.fill(USER);
  await terlihat(page.locator("input[name=password], input[type=password]")).first().fill(SANDI);
  await page.waitForTimeout(500);
  await klikTeks(page, /^(log ?in|masuk)$/i, { tag: "button" });
  await page.waitForTimeout(7000);
  for (let i = 0; i < 2 && (await halamanLogin(page) || /verif/i.test(page.url())); i++) {
    const teks = (await page.locator("body").innerText().catch(() => "")).slice(0, 3000);
    if (/geser|slide|puzzle|captcha|traffic|lalu lintas/i.test(teks)) {
      await jejak("Shopee menampilkan captcha geser", { teks: true });
      throw new Gagal("Shopee menampilkan verifikasi geser (captcha). Robot berhenti; jalankan lagi beberapa saat kemudian.");
    }
    if (/salah|incorrect|invalid|tidak valid/i.test(teks) && /sandi|password/i.test(teks)) throw new Gagal("Username/password sub akun Shopee ditolak. Periksa GitHub Secrets SHOPEE_SUB_USER / SHOPEE_SUB_PASSWORD.");
    if (!(await isiOtp(page))) break;
  }
  if (await halamanLogin(page)) { await jejak("Login belum berhasil", { teks: true }); throw new Gagal("Login sub akun Shopee belum berhasil. Lihat catatan langkah di Seller Fintech."); }
  await jejak("Login berhasil");
}

// Penghasilan Saya meminta password lagi
async function verifikasiPassword(page) {
  for (let i = 0; i < 3; i++) {
    const kolom = terlihat(page.locator("input[type=password]"));
    if (!(await kolom.count())) return;
    await jejak("Shopee meminta password lagi");
    await kolom.first().fill(SANDI);
    await page.waitForTimeout(400);
    const ok = await klikTeks(page, /^(konfirmasi|verifikasi|lanjut|ok|kirim|masuk|confirm|verify|submit|next)$/i, { tag: "button" });
    if (!ok) await kolom.first().press("Enter");
    await page.waitForTimeout(5000);
    if (await isiOtp(page)) await page.waitForTimeout(2000);
  }
}

// ------------------------------------------------------------------ toko
async function bukaMenuAkun(page) {
  // kanan atas: nama toko + "Utama:SubAkun"
  const kandidat = terlihat(page.locator("header *, [class*='navbar'] *, [class*='header'] *")
    .filter({ hasText: /:/ }).filter({ hasText: USER.split(":").pop() || "§" }));
  if (await kandidat.count()) { await kandidat.last().click().catch(() => {}); await page.waitForTimeout(1500); return true; }
  const ava = terlihat(page.locator("[class*='account'], [class*='avatar'], [class*='user-info'], [class*='shop-switch']")).first();
  if (await ava.count()) { await ava.click().catch(() => {}); await page.waitForTimeout(1500); return true; }
  return false;
}

async function daftarToko(page) {
  await bukaMenuAkun(page);
  await jejak("Menu akun dibuka", { teks: true });
  if (await klikTeks(page, /ganti toko|pindah toko|switch shop|beralih toko|change shop/i)) {
    await page.waitForTimeout(2500);
    await jejak("Daftar toko dibuka", { teks: true });
  }
  const nama = await page.evaluate(() => {
    const lihat = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const wadah = [...document.querySelectorAll("[role=dialog], .shopee-modal, .eds-modal, [class*='popover'], [class*='dropdown'], [class*='shop-list'], [class*='switch']")].filter(lihat);
    const set = new Set();
    for (const w of wadah) {
      for (const el of w.querySelectorAll("[class*='shop-name'], [class*='shopName'], [class*='name'], li")) {
        const t = (el.innerText || "").split("\n")[0].trim();
        if (t && t.length <= 60 && !/ganti|pindah|switch|keluar|logout|pengaturan|setting|akun|profil|bahasa|language|bantuan|help|cari|search/i.test(t)) set.add(t);
      }
    }
    return [...set];
  }).catch(() => []);
  await page.keyboard.press("Escape").catch(() => {});
  return nama;
}

async function pindahToko(page, nama) {
  await page.goto(URL_PENGHASILAN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await bukaMenuAkun(page);
  await klikTeks(page, /ganti toko|pindah toko|switch shop|beralih toko|change shop/i);
  await page.waitForTimeout(2000);
  const cari = terlihat(page.locator("[role=dialog] input[type=text], .shopee-modal input[type=text], .eds-modal input[type=text]")).first();
  if (await cari.count()) { await cari.fill(nama); await page.waitForTimeout(1500); }
  const re = new RegExp("^" + nama.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
  if (!(await klikTeks(page, re))) throw new Gagal(`Toko "${nama}" tidak ditemukan di daftar ganti toko.`);
  await page.waitForTimeout(6000);
  await tutupPopup(page);
  await jejak(`Pindah ke toko ${nama}`);
}

// ------------------------------------------------------------------ export & unduh
async function pilihRentang(page, dari, sampai) {
  // buka kotak periode (tulisan "Minggu Ini: ..." / "Pilih Tanggal")
  const kotak = terlihat(page.locator("[class*='date'], [class*='picker'], [class*='range']").filter({ hasText: /\d{2}\/\d{2}\/\d{4}|minggu ini|bulan ini|pilih tanggal/i })).first();
  await kotak.click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await klikTeks(page, /^pilih tanggal$/i);
  await page.waitForTimeout(1200);
  const [y, m] = dari.split("-").map(Number);
  // geser panel kiri sampai bulan yang dicari
  for (let i = 0; i < 24; i++) {
    const judul = await page.evaluate(() => {
      const el = [...document.querySelectorAll("*")].find((e) => e.children.length <= 2 && /^(January|February|March|April|May|June|July|August|September|October|November|December|Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s*\d{4}$/i.test((e.innerText || "").replace(/\s+/g, " ").trim()) && e.getBoundingClientRect().width > 0);
      return el ? el.innerText.replace(/\s+/g, " ").trim() : "";
    });
    const mm = judul.match(/([A-Za-z]+)\s*(\d{4})/);
    if (!mm) throw new Gagal("Kalender Shopee tidak terbaca.");
    const bi = Math.max(BULAN_EN.findIndex((b) => b.toLowerCase() === mm[1].toLowerCase()), BULAN_ID.findIndex((b) => b.toLowerCase() === mm[1].toLowerCase()));
    const sel = (Number(mm[2]) - y) * 12 + (bi + 1 - m);
    if (sel === 0) break;
    const tombol = sel > 0
      ? terlihat(page.locator("[class*='prev']:not([class*='year']), [class*='left-arrow'], [aria-label*='prev' i]")).first()
      : terlihat(page.locator("[class*='next']:not([class*='year']), [class*='right-arrow'], [aria-label*='next' i]")).first();
    await tombol.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  const hari = async (tgl) => {
    const d = String(Number(tgl.slice(8, 10)));
    // panel kiri = panel pertama yang terlihat; hindari tanggal abu-abu/di luar bulan
    const ok = await page.evaluate((d) => {
      const lihat = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const sel = [...document.querySelectorAll("td, [class*='date-cell'], [class*='day'], [class*='cell']")].filter(lihat)
        .filter((e) => (e.innerText || "").trim() === d && !/(disabled|out|other|prev-month|next-month|not-current)/i.test(e.className || ""));
      if (!sel.length) return false;
      sel.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      sel[0].click();
      return true;
    }, d);
    if (!ok) throw new Gagal(`Tanggal ${fmt(tgl)} tidak bisa dipilih di kalender Shopee.`);
    await page.waitForTimeout(700);
  };
  await hari(dari);
  await hari(sampai);
  await page.waitForTimeout(1500);
  await klikTeks(page, /^(konfirmasi|terapkan|ok|confirm|apply|simpan)$/i, { tag: "button" });
  await page.waitForTimeout(2500);
}

async function exportDanUnduh(page, label) {
  const ok = await klikTeks(page, /^(export|ekspor)$/i, { tag: "button" });
  if (!ok) throw new Gagal(`Tombol Export (${label}) tidak ditemukan.`);
  await page.waitForTimeout(2500);
  // bila ada jendela konfirmasi export
  await klikTeks(page, /^(export|ekspor|konfirmasi|ok|confirm)$/i, { scope: page.locator("[role=dialog], .shopee-modal, .eds-modal"), tag: "button" });
  await page.waitForTimeout(3000);
  await jejak(`Export ${label} diminta`);
  const batas = Date.now() + TUNGGU_EKSPOR;
  while (Date.now() < batas) {
    // daftar laporan: ikon di samping tombol Export (bertanda angka)
    const ikon = terlihat(page.locator("button, div, span, i").filter({ has: page.locator("[class*='badge'], sup") })).filter({ hasNotText: /export|ekspor/i });
    const btnExport = terlihat(page.locator("button").filter({ hasText: /^(export|ekspor)$/i })).first();
    let dibuka = false;
    if (await btnExport.count()) {
      const kotakE = await btnExport.boundingBox();
      if (kotakE) {
        const n = await ikon.count();
        for (let i = 0; i < Math.min(n, 30) && !dibuka; i++) {
          const b = await ikon.nth(i).boundingBox().catch(() => null);
          if (b && Math.abs(b.y - kotakE.y) < 30 && b.x > kotakE.x && b.x - kotakE.x < 140) { await ikon.nth(i).click().catch(() => {}); dibuka = true; }
        }
      }
    }
    await page.waitForTimeout(2500);
    const unduh = terlihat(page.locator("button, a").filter({ hasText: /^(download|unduh)$/i })).first();
    if (await unduh.count()) {
      const aktif = await unduh.isEnabled().catch(() => false);
      if (aktif) {
        const [file] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), unduh.click()]);
        const isi = await fs.readFile(await file.path());
        await jejak(`File ${label} terunduh (${Math.round(isi.length / 1024)} KB)`, { layar: false });
        await page.keyboard.press("Escape").catch(() => {});
        return { isi, nama: file.suggestedFilename() };
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(15000);
  }
  await jejak(`Laporan ${label} belum siap`, { teks: true });
  throw new Gagal(`Laporan ${label} belum siap diunduh setelah ${TUNGGU_EKSPOR / 60000} menit.`);
}

async function ambilPenghasilan(page, dari, sampai) {
  await page.goto(URL_PENGHASILAN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await verifikasiPassword(page);
  await tutupPopup(page);
  await klikTeks(page, /^sudah dilepas$/i);
  await page.waitForTimeout(2500);
  await pilihRentang(page, dari, sampai);
  await jejak(`Penghasilan ${fmt(dari)}–${fmt(sampai)} dipilih`);
  return exportDanUnduh(page, "Penghasilan");
}

async function ambilMutasi(page, dari, sampai) {
  await page.goto(URL_PENGHASILAN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  if (!(await klikTeks(page, /^saldo saya$/i, { tag: "a, span, div, li" }))) throw new Gagal("Menu Saldo Saya tidak ditemukan.");
  await page.waitForTimeout(5000);
  await verifikasiPassword(page);
  await tutupPopup(page);
  await pilihRentang(page, dari, sampai);
  await jejak(`Mutasi saldo ${fmt(dari)}–${fmt(sampai)} dipilih`);
  return exportDanUnduh(page, "Saldo");
}

// ------------------------------------------------------------------ jalan
async function main() {
  if (!KEY || !RUN_ID) throw new Error("SUPABASE_SERVICE_KEY / RUN_ID kosong.");
  const run = (await sb(`/rest/v1/shopee_robot_run?id=eq.${RUN_ID}&select=*`))[0];
  if (!run) throw new Error("Catatan robot tidak ditemukan: " + RUN_ID);
  const C = run.company_id;
  await ubahRun({ status: "BERJALAN", mulai: new Date().toISOString(), log_url: LOG_URL, hasil: null, debug_img: null, jejak: [] });

  const browser = await chromium.launch({ headless: true });
  const sesi = await unduhSesi().catch(() => null);
  const context = await browser.newContext({
    locale: "id-ID", timezoneId: "Asia/Jakarta", acceptDownloads: true, viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    ...(sesi ? { storageState: sesi } : {}),
  });
  const page = await context.newPage();
  PAGE = page;
  const simpanSesi = () => context.storageState().then((s) => unggah(SESI_BUCKET, SESI_PATH, JSON.stringify(s), "application/json")).catch(() => {});
  const ringkas = [];
  let gagalToko = 0, berhasil = 0;
  try {
    await page.goto(URL_PENGHASILAN, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    if (await halamanLogin(page)) { await login(page); await page.goto(URL_PENGHASILAN, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(5000); }
    await simpanSesi();
    await verifikasiPassword(page);
    await tutupPopup(page);
    await jejak("Halaman Penghasilan Saya", { teks: true });

    let toko = await daftarToko(page);
    if (!toko.length) {
      // sub akun hanya 1 toko / daftar belum terbaca: pakai toko yang sedang terbuka
      const nm = await page.evaluate(() => (document.querySelector("[class*='shop-name'], [class*='shopName']") || {}).innerText || "").catch(() => "");
      toko = [nm.split("\n")[0].trim() || "Toko Shopee"];
    }
    // catat toko yang ditemukan (toko baru menunggu dipetakan di Seller Fintech)
    await sb("/rest/v1/shopee_toko_peta?on_conflict=company_id,nama_shopee", {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(toko.map((nama_shopee) => ({ company_id: C, nama_shopee }))),
    });
    const peta = await sb(`/rest/v1/shopee_toko_peta?company_id=eq.${C}&select=nama_shopee,aktif`);
    const nonaktif = new Set((peta || []).filter((p) => p.aktif === false).map((p) => p.nama_shopee));
    toko = toko.filter((t) => !nonaktif.has(t));
    await jejak(`${toko.length} toko: ${toko.join(", ")}`, { layar: false });
    if (MODE === "eksplor") {
      await ubahRun({ status: "BERHASIL", selesai: new Date().toISOString(), hasil: `Mode eksplor: login berhasil, ${toko.length} toko terbaca (${toko.join(", ")}).` });
      return;
    }

    const potong = pecahPerBulan(run.dari_tgl, run.sampai_tgl);
    for (const nama of toko) {
      const hasilToko = [];
      try {
        if (toko.length > 1) await pindahToko(page, nama);
        for (const [d1, d2] of potong) {
          for (const [jenis, fn] of [["income", ambilPenghasilan], ["mutasi", ambilMutasi]]) {
            try {
              const { isi, nama: namaFile } = await fn(page, d1, d2);
              if (isi.length < 500) throw new Gagal("file kosong");
              const aman = nama.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
              const path = `${C}/${run.id}/${aman}_${jenis}_${d1}_${d2}.xlsx`;
              await unggah("shopee-inbox", path, isi, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
              await sb("/rest/v1/shopee_robot_file", {
                method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify({ company_id: C, run_id: run.id, nama_shopee: nama, jenis, dari_tgl: d1, sampai_tgl: d2, path, nama_file: namaFile, ukuran: isi.length }),
              });
              hasilToko.push(`${jenis === "income" ? "penghasilan" : "saldo"} ✓`);
              berhasil++;
            } catch (e) {
              hasilToko.push(`${jenis === "income" ? "penghasilan" : "saldo"} ✗ (${String(e.message).slice(0, 80)})`);
              if (jenis === "income") gagalToko++;
            }
            await simpanSesi();
          }
        }
      } catch (e) {
        gagalToko++;
        hasilToko.push(`✗ ${String(e.message).slice(0, 100)}`);
      }
      ringkas.push(`${nama}: ${hasilToko.join(", ")}`);
      await ubahRun({ hasil: ringkas.join(" · ") });
    }
    await ubahRun({ status: gagalToko ? (berhasil ? "SEBAGIAN" : "GAGAL") : "BERHASIL", selesai: new Date().toISOString(),
      hasil: ringkas.join(" · ") || "Tidak ada toko yang diproses." });
  } catch (e) {
    await jejak("Berhenti: " + String(e.message).slice(0, 120), { teks: true }).catch(() => {});
    const kecil = await page.screenshot({ type: "jpeg", quality: 45 }).catch(() => null);
    const pesan = e instanceof Gagal ? e.message : `Robot berhenti: ${String(e.message || e).slice(0, 300)}`;
    await ubahRun({ status: "GAGAL", selesai: new Date().toISOString(), hasil: [pesan, ...ringkas].join(" · "),
      debug_img: kecil ? "data:image/jpeg;base64," + kecil.toString("base64") : null }).catch(() => {});
    console.error(pesan);
    process.exitCode = 1;
  } finally {
    await simpanSesi();
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
