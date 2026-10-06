// Robot 1 — ambil pesanan BigSeller lalu titipkan ke Raksa (Supabase).
// Berjalan di GitHub Actions (lihat .github/workflows/robot1.yml).
//
// Langkah BigSeller sama dengan yang sudah diuji di UI.Vision:
//   Pesanan → kalender "Waktu Pesanan Dibuat" → Ekspor ▸ Ekspor Semua Pesanan →
//   Jenis Ekspor "Ekspor Berdasarkan Sub SKU Gudang" → Ekspor → tunggu "Ekspor Selesai" → Unduh
//
// File hasil diunggah ke Storage "robot-inbox". Raksa memprosesnya otomatis saat
// dibuka Owner/Admin (pesanan yang sama tidak pernah tercatat dobel).
//
// Rahasia yang dibutuhkan (GitHub → Settings → Secrets and variables → Actions):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, BIGSELLER_EMAIL, BIGSELLER_PASSWORD

import { chromium } from "playwright";
import fs from "node:fs/promises";

const URL_SB = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY || "";
const EMAIL = process.env.BIGSELLER_EMAIL || "";
const SANDI = process.env.BIGSELLER_PASSWORD || "";
const HARI = Number(process.env.RENTANG_HARI || 3);           // ambil N hari terakhir (termasuk hari ini)
const LOG_URL = process.env.GITHUB_RUN_URL || null;
const BS_PESANAN = "https://www.bigseller.com/web/order/index.htm?status=all";
const BS_LOGIN = "https://www.bigseller.com/login.htm";
const SESI_BUCKET = "robot-sesi";               // bucket privat, hanya bisa dibaca robot (kunci service)
const SESI_PATH = "bigseller-state.json";

const H = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, ...extra });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function sb(path, opt = {}) {
  const r = await fetch(`${URL_SB}${path}`, { ...opt, headers: H(opt.headers) });
  if (!r.ok) throw new Error(`Supabase ${opt.method || "GET"} ${path} → ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const catatRun = (isi) => sb("/rest/v1/robot_run", {
  method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(isi),
}).then((r) => r[0]);
const ubahRun = (id, isi) => sb(`/rest/v1/robot_run?id=eq.${id}`, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isi),
});
async function unggah(path, isi, tipe, bucket = "robot-inbox") {
  const r = await fetch(`${URL_SB}/storage/v1/object/${bucket}/${path}`, {
    method: "POST", headers: H({ "Content-Type": tipe, "x-upsert": "true" }), body: isi,
  });
  if (!r.ok) throw new Error(`Unggah ${path} gagal: ${r.status} ${await r.text()}`);
}
async function unduhSesi() {
  const r = await fetch(`${URL_SB}/storage/v1/object/${SESI_BUCKET}/${SESI_PATH}`, { headers: H() });
  return r.ok ? r.json() : null;
}
async function bersihkanLama() {
  // File robot yang tidak pernah diproses dibuang setelah 7 hari.
  try {
    const daftar = await sb("/storage/v1/object/list/robot-inbox", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "pesanan", limit: 200, sortBy: { column: "created_at", order: "asc" } }),
    });
    const batas = Date.now() - 7 * 864e5;
    const lama = (daftar || []).filter((f) => f.created_at && new Date(f.created_at).getTime() < batas).map((f) => `pesanan/${f.name}`);
    if (lama.length) {
      await sb("/storage/v1/object/robot-inbox", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: lama }),
      });
      log(`Membersihkan ${lama.length} file lama`);
    }
  } catch (e) { log("Lewati pembersihan:", e.message); }
}

// Tanggal di zona WIB
const wib = (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const sampai = wib(new Date());
const dari = wib(new Date(Date.now() - (HARI - 1) * 864e5));
const fmt = (s) => s.split("-").reverse().join("/");

class Gagal extends Error {}

async function login(page) {
  log("Membuka halaman login BigSeller");
  await page.goto(BS_LOGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (!/login/i.test(page.url())) return; // sesi lama masih berlaku
  const akun = page.locator("input[type=email], input[name*=account i], input[name*=email i], input[placeholder*=mail i], input[placeholder*=akun i], input[type=text]").first();
  const sandi = page.locator("input[type=password]").first();
  await akun.fill(EMAIL);
  await sandi.fill(SANDI);
  const tombol = page.locator("button[type=submit], button:has-text('Masuk'), button:has-text('Login'), button:has-text('Log In'), .login-btn").first();
  await tombol.click();
  await page.waitForTimeout(6000);
  const teks = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
  if (/captcha|verifikasi|verification|kode otp|otp code|slide to|geser/i.test(teks) && /login/i.test(page.url()))
    throw new Gagal("BigSeller meminta OTP / captcha dari server GitHub. Robot tidak mengisinya. Jalankan Robot 1 manual (UI.Vision) atau pakai PC kantor.");
  if (/login/i.test(page.url())) throw new Gagal("Login BigSeller gagal. Periksa BIGSELLER_EMAIL dan BIGSELLER_PASSWORD di GitHub Secrets.");
  log("Login berhasil");
}

async function ekspor(page) {
  log("Membuka halaman Pesanan");
  await page.goto(BS_PESANAN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  if (/login/i.test(page.url())) { await login(page); await page.goto(BS_PESANAN, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(6000); }

  log(`Periode Waktu Pesanan Dibuat ${dari} s/d ${sampai}`);
  await page.locator("xpath=//input[contains(@class,'ant-calendar-range-picker-input') and @placeholder='Waktu Mulai']").first().click();
  await page.waitForTimeout(900);
  const mulai = page.locator("xpath=//input[contains(@class,'ant-calendar-input') and @placeholder='Waktu Mulai']").first();
  await mulai.fill(`${dari} 00:00:00`);
  await page.waitForTimeout(400);
  const akhir = page.locator("xpath=//input[contains(@class,'ant-calendar-input') and @placeholder='Waktu Berakhir']").first();
  await akhir.fill(`${sampai} 23:59:59`);
  await page.waitForTimeout(500);
  await page.locator("xpath=//a[contains(@class,'ant-calendar-ok-btn')]").first().click();
  await page.waitForTimeout(3500);

  log("Membuka menu Ekspor");
  const tombolEkspor = page.locator("xpath=(//button[normalize-space()='Ekspor'])[1]");
  await tombolEkspor.hover();
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const b = document.evaluate("(//button[normalize-space()='Ekspor'])[1]", document, null, 9, null).singleNodeValue;
    if (!b) return;
    const t = b.closest(".ant-dropdown-trigger") || b;
    t.dispatchEvent(new MouseEvent("mouseenter"));
    let v = t.__vue__;
    for (let i = 0; v && i < 6; i++) { if (typeof v.setPopupVisible === "function") { v.setPopupVisible(true); return; } v = v.$parent; }
  });
  const semua = page.locator("xpath=(//span[contains(@class,'dropdown_content')]//*[normalize-space(text())='Ekspor Semua Pesanan'])[last()]");
  await semua.waitFor({ state: "visible", timeout: 20000 });
  await semua.click();
  await page.waitForTimeout(2500);

  log("Jenis Ekspor: per Sub SKU Gudang");
  await page.locator("xpath=//div[contains(@class,'ant-modal')]//div[contains(@class,'ant-select-selection-selected-value')]").first().click();
  await page.waitForTimeout(900);
  await page.locator("xpath=//li[contains(@class,'ant-select-dropdown-menu-item') and normalize-space()='Ekspor Berdasarkan Sub SKU Gudang']").first().click();
  await page.waitForTimeout(900);
  await page.locator("xpath=//div[contains(@class,'ant-modal')]//button[normalize-space()='Ekspor']").first().click();

  log("Menunggu Ekspor Selesai (maks. 5 menit)");
  await page.locator("xpath=//*[contains(normalize-space(text()),'Ekspor Selesai')]").first().waitFor({ timeout: 300000 });
  const [unduhan] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    page.locator("xpath=//a[contains(@class,'ant-btn') and normalize-space()='Unduh']").first().click(),
  ]);
  const jalur = await unduhan.path();
  const isi = await fs.readFile(jalur);
  log(`File terunduh: ${unduhan.suggestedFilename()} (${Math.round(isi.length / 1024)} KB)`);
  if (isi.length < 2000) throw new Gagal("File ekspor BigSeller kosong atau rusak.");
  return { isi, nama: unduhan.suggestedFilename() };
}

async function main() {
  if (!URL_SB || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY belum diisi di GitHub Secrets.");
  const run = await catatRun({
    robot: "ROBOT1", sumber: "GITHUB", status: "BERJALAN", oleh: "Robot GitHub",
    keterangan: `Impor pesanan ${fmt(dari)} s/d ${fmt(sampai)}`, dari_tgl: dari, sampai_tgl: sampai, log_url: LOG_URL,
  });
  log("Robot 1 mulai, run", run.id);

  const browser = await chromium.launch({ headless: true });
  const sesi = await unduhSesi().catch(() => null);
  const context = await browser.newContext({
    locale: "id-ID", timezoneId: "Asia/Jakarta", acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    ...(sesi ? { storageState: sesi } : {}),
  });
  const page = await context.newPage();
  try {
    if (!sesi && (!EMAIL || !SANDI)) throw new Gagal("BIGSELLER_EMAIL / BIGSELLER_PASSWORD belum diisi di GitHub Secrets.");
    if (!sesi) await login(page);
    const { isi } = await ekspor(page);
    // simpan sesi supaya jadwal berikutnya tidak perlu login ulang (mengurangi risiko OTP)
    await unggah(SESI_PATH, JSON.stringify(await context.storageState()), "application/json", SESI_BUCKET).catch(() => {});
    const jam = new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 19).replace(/:/g, "");
    const path = `pesanan/${sampai}_${jam}_${run.id.slice(0, 8)}.xlsx`;
    await unggah(path, isi, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await ubahRun(run.id, { status: "BERHASIL", selesai: new Date().toISOString(), file_path: path });
    log("Selesai: file dititipkan ke Raksa", path);
  } catch (e) {
    await page.screenshot({ path: "gagal.png", fullPage: true }).catch(() => {});
    const pesan = e instanceof Gagal ? e.message : `Robot berhenti: ${String(e.message || e).slice(0, 300)}`;
    await ubahRun(run.id, { status: "GAGAL", selesai: new Date().toISOString(), hasil: pesan }).catch(() => {});
    console.error(pesan);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await bersihkanLama();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
