// Robot 2 — kirim penambahan & pengurangan stok dari Raksa ke BigSeller (server GitHub).
// Berjalan Senin–Sabtu 19.00 WIB (lihat .github/workflows/robot2.yml) bila Owner menyalakan
// "Robot 2 otomatis" di Raksa, atau kapan saja lewat Run workflow.
//
// Langkah BigSeller sama dengan Robot 2 UI.Vision yang sudah dipakai:
//   Penambahan/Pengurangan Stok → Impor & Ekspor ▸ Impor & Perbarui → catatan batch + file → Impor
//   → baca Berhasil/Gagal → Tutup → klik ikon konfirmasi pada baris catatan batch → Konfirmasi
//   → cek baris sudah hilang dari Pending.
//
// Aturan aman:
//   • Tidak ada pergerakan "Siap impor" → robot berhenti tanpa membuka BigSeller.
//   • Pergerakan yang sedang dikirim ditandai DIKIRIM_ROBOT dulu, jadi tidak pernah terkirim dua kali
//     walau robot terhenti di tengah jalan.
//   • Ditolak BigSeller (mis. stok kurang) → pergerakan ditahan sebagai GAGAL_BIGSELLER sampai Owner
//     memutuskan (kirim ulang / batalkan), lalu Owner & Admin mendapat notifikasi di HP.
//
// Mode (MODE): otomatis (jadwal; hanya jalan bila disalakan di Raksa) | kirim (manual) | uji (tanpa mengubah stok).

import { chromium } from "playwright";
import XLSX from "xlsx";
import fs from "node:fs/promises";

const URL_SB = (() => { const v = (process.env.SUPABASE_URL || "").trim(); try { return new URL(v).origin; } catch { return v.replace(/\/+$/, ""); } })();
const KEY = process.env.SUPABASE_SERVICE_KEY || "";
const EMAIL = process.env.BIGSELLER_EMAIL || "";
const SANDI = process.env.BIGSELLER_PASSWORD || "";
const MODE = (process.env.MODE || "otomatis").trim();
const LOG_URL = process.env.GITHUB_RUN_URL || null;
const BS_LOGIN = "https://www.bigseller.com/login.htm";
const BS_URL = {
  tambah: "https://www.bigseller.com/web/inventory/inout/list/in/index.htm",
  kurang: "https://www.bigseller.com/web/inventory/inout/list/out/index.htm",
};
const NAMA = { tambah: "Penambahan", kurang: "Pengurangan" };
const SESI_BUCKET = "robot-sesi";
const SESI_PATH = "bigseller-state.json";
const OLEH = "Robot 2 (server)";

const H = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, ...extra });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
class Gagal extends Error {}

async function sb(path, opt = {}) {
  const r = await fetch(`${URL_SB}${path}`, { ...opt, headers: H(opt.headers) });
  if (!r.ok) throw new Error(`Supabase ${opt.method || "GET"} ${path.slice(0, 80)} → ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const catatRun = (isi) => sb("/rest/v1/robot_run", {
  method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(isi),
}).then((r) => r[0]);
const ubahRun = (id, isi) => sb(`/rest/v1/robot_run?id=eq.${id}`, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isi),
});
async function unggah(path, isi, tipe, bucket) {
  const r = await fetch(`${URL_SB}/storage/v1/object/${bucket}/${path}`, { method: "POST", headers: H({ "Content-Type": tipe, "x-upsert": "true" }), body: isi });
  if (!r.ok) throw new Error(`Unggah ${path} gagal: ${r.status} ${await r.text()}`);
}
async function unduhSesi() {
  const r = await fetch(`${URL_SB}/storage/v1/object/${SESI_BUCKET}/${SESI_PATH}`, { headers: H() });
  return r.ok ? r.json() : null;
}
async function notif(judul, isi) {
  try {
    const r = await fetch(`${URL_SB}/functions/v1/kirim-notif`, {
      method: "POST", headers: H({ "Content-Type": "application/json" }),
      body: JSON.stringify({ target: "admin", judul, isi, url: "/", tag: "raksa-robot2" }),
    });
    log("Notifikasi:", r.status, (await r.text()).slice(0, 200));
  } catch (e) { log("Notifikasi gagal dikirim:", e.message); }
}

// ------------------------------------------------------------------ data Raksa
const muatDok = (koleksi, filter = "") =>
  sb(`/rest/v1/dokumen?koleksi=eq.${koleksi}&dihapus=is.false${filter}&select=id,data`).then((r) => r || []);
async function simpanDok(koleksi, docs) {
  for (let i = 0; i < docs.length; i += 300) {
    const potong = docs.slice(i, i + 300).map((d) => ({ koleksi, id: String(d.id), data: d, dihapus: false }));
    await sb("/rest/v1/dokumen?on_conflict=koleksi,id", {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(potong),
    });
  }
}
async function ubahPergerakan(list, tambahan) {
  if (!list.length) return;
  const sekarang = new Date().toISOString();
  const baru = list.map((m) => ({ ...m, ...tambahan, diubahRobotPada: sekarang }));
  await simpanDok("movements", baru);
  baru.forEach((b, i) => Object.assign(list[i], b));
}

// Sama dengan fungsi UD di Raksa (Ekspor BigSeller): gabung per SKU, mode net atau kotor.
function rekap(mv, mode = "net") {
  const r = {};
  for (const a of mv) { const i = r[a.sku] || (r[a.sku] = { sku: a.sku, tambah: 0, kurang: 0 }); a.arah === "TAMBAH" ? i.tambah += a.qty : i.kurang += a.qty; }
  const n = Object.values(r).map((a) => ({ ...a, net: a.tambah - a.kurang })).sort((a, b) => a.sku.localeCompare(b.sku));
  return mode === "kotor"
    ? { penambahan: n.filter((a) => a.tambah > 0).map((a) => ({ sku: a.sku, qty: a.tambah })), pengurangan: n.filter((a) => a.kurang > 0).map((a) => ({ sku: a.sku, qty: a.kurang })) }
    : { penambahan: n.filter((a) => a.net > 0).map((a) => ({ sku: a.sku, qty: a.net })), pengurangan: n.filter((a) => a.net < 0).map((a) => ({ sku: a.sku, qty: -a.net })) };
}
// Format file sama persis dengan tombol unduh di halaman Ekspor BigSeller.
function fileStok(part, rows, { hargaMode = "kosong", modal = {} } = {}) {
  const aoa = part === "tambah"
    ? [["*Nomor SKU (SKU atau GTIN Wajib Diisi)", "*GTIN (SKU atau GTIN Wajib Diisi)", "*Jumlah Penambahan Stok", "Harga Satuan", "Tanggal Produksi", "Tanggal Kedaluwarsa", "Nomor Seri"],
      ...rows.map((n) => [n.sku, "", n.qty, hargaMode === "modal" && modal[n.sku] || "", "", "", ""])]
    : [["*Nomor SKU", "*Jumlah Pengurangan Stok", "Nomor Seri"], ...rows.map((n) => [n.sku, n.qty, ""])];
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = (part === "tambah" ? [40, 34, 24, 14, 16, 18, 14] : [32, 26, 14]).map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, "SKU");
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
}

// ------------------------------------------------------------------ BigSeller
let RUN_ID = null;
async function login(page) {
  log("Membuka halaman login BigSeller");
  await page.goto(BS_LOGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (!/login/i.test(page.url())) return;
  if (!EMAIL || !SANDI) throw new Gagal("Sesi BigSeller habis dan BIGSELLER_EMAIL / BIGSELLER_PASSWORD belum diisi di GitHub Secrets.");
  for (let coba = 1; coba <= 3; coba++) {
    await page.locator("input[name=account]").first().fill(EMAIL);
    await page.locator("input[name=password]").first().fill(SANDI);
    const setuju = page.locator(".el-checkbox:not(.is-checked) .el-checkbox__inner").first();
    if (await setuju.count()) await setuju.click().catch(() => {});
    const kodeInput = page.locator("input[name=picVerificationCode]").first();
    if (await kodeInput.count()) {
      const gambar = page.locator("xpath=(//input[@name='picVerificationCode']/ancestor::*[.//img][1]//img)[1]");
      const png = await gambar.screenshot().catch(() => null) || await page.screenshot({ clip: { x: 0, y: 0, width: 800, height: 600 } });
      await ubahRun(RUN_ID, { captcha_img: "data:image/png;base64," + png.toString("base64"), captcha_jawab: null, captcha_minta: new Date().toISOString(), hasil: "Menunggu kode captcha BigSeller dari Owner/Admin di Raksa" });
      await notif("Robot 2 butuh kode captcha", "Buka Raksa lalu ketik kode captcha BigSeller supaya robot bisa mengirim stok.");
      log(`Menunggu kode captcha diketik di Raksa (percobaan ${coba})`);
      let jawab = null;
      for (let i = 0; i < 200 && !jawab; i++) {
        await page.waitForTimeout(3000);
        const r = await sb(`/rest/v1/robot_run?id=eq.${RUN_ID}&select=captcha_jawab`);
        jawab = r && r[0] && r[0].captcha_jawab;
      }
      if (!jawab) throw new Gagal("Tidak ada yang mengisi kode captcha BigSeller dalam 10 menit. Stok belum dikirim; jalankan ulang Robot 2.");
      await ubahRun(RUN_ID, { captcha_img: null, hasil: null });
      await kodeInput.fill(String(jawab).trim());
    }
    await page.locator("button:has-text('Log In'), button:has-text('Masuk'), button:has-text('Login')").first().click();
    await page.waitForTimeout(6000);
    if (!/login/i.test(page.url())) { log("Login berhasil"); return; }
    const teks = (await page.locator("body").innerText().catch(() => "")).slice(0, 2000);
    if (/otp|sms|kode verifikasi dikirim|verification code (has been )?sent/i.test(teks))
      throw new Gagal("BigSeller meminta OTP (SMS/email). Stok belum dikirim; jalankan Robot 2 manual.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
  }
  throw new Gagal("Login BigSeller gagal 3 kali. Stok belum dikirim.");
}
async function tutupPopup(page) {
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Escape").catch(() => {});
    const n = await page.evaluate(() => {
      const terlihat = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      let klik = 0;
      for (const w of [...document.querySelectorAll(".ant-modal-wrap, .el-dialog__wrapper, .el-message-box__wrapper, .ant-notification, .el-notification")].filter(terlihat)) {
        if (w.querySelector("textarea.noteText")) continue; // jendela impor milik robot sendiri
        const tutup = w.querySelector(".ant-modal-close, .el-dialog__headerbtn, .el-message-box__headerbtn, .ant-notification-notice-close, .el-notification__closeBtn");
        if (tutup && terlihat(tutup)) { tutup.click(); klik++; continue; }
        const tombol = [...w.querySelectorAll("button")].filter(terlihat).find((b) => /^(tutup|close|ok|oke|mengerti|saya mengerti|got it|lewati|skip|nanti|later|i know|saya tahu)$/i.test((b.innerText || "").trim()));
        if (tombol) { tombol.click(); klik++; }
      }
      for (const w of [...document.querySelectorAll("[class*='guide']")].filter(terlihat)) {
        const t = [...w.querySelectorAll("button, a, span")].filter(terlihat).filter((b) => b.children.length === 0)
          .find((b) => /^(×|x|tutup|close|ok|oke|mengerti|saya mengerti|saya tahu|tahu|got it|i know|lewati|skip|selesai|done|berikutnya|next)$/i.test((b.innerText || "").trim()));
        if (t) { t.click(); klik++; }
      }
      for (const m of [...document.querySelectorAll("[class*='guide_mask'], [class*='guide-mask'], [class*='guideMask']")].filter(terlihat)) { m.remove(); klik++; }
      return klik;
    }).catch(() => 0);
    if (!n) break;
    await page.waitForTimeout(800);
  }
}
async function bukaHalaman(page, part) {
  await page.goto(BS_URL[part], { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  if (/login/i.test(page.url())) { await login(page); await page.goto(BS_URL[part], { waitUntil: "domcontentloaded" }); await page.waitForTimeout(5000); }
  await tutupPopup(page);
}
async function bukaImpor(page) {
  await page.evaluate(() => {
    const b = document.evaluate("(//button[normalize-space()='Impor & Ekspor'])[1]", document, null, 9, null).singleNodeValue;
    if (!b) return;
    const t = b.closest(".ant-dropdown-trigger") || b;
    t.dispatchEvent(new MouseEvent("mouseenter"));
    let v = t.__vue__;
    for (let i = 0; v && i < 6; i++) { if (typeof v.setPopupVisible === "function") { v.setPopupVisible(true); return; } v = v.$parent; }
  });
  await page.locator("xpath=(//button[normalize-space()='Impor & Ekspor'])[1]").hover().catch(() => {});
  const item = page.locator("xpath=//li[contains(@class,'ant-dropdown-menu-item') and normalize-space()='Impor & Perbarui']").last();
  await item.waitFor({ state: "visible", timeout: 20000 });
  await item.click();
  await page.locator("xpath=//div[contains(@class,'ant-modal')]//textarea[contains(@class,'noteText')]").first().waitFor({ timeout: 20000 });
}
const teksJendela = (page) => page.evaluate(() => [...document.querySelectorAll(".ant-modal-wrap, .ant-message, .ant-notification, .el-message, .el-message-box__wrapper")]
  .filter((m) => { const r = m.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(m).display !== "none"; })
  .map((m) => (m.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ")).catch(() => "");
async function bacaHasil(page, n) {
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(1500);
    const r = await page.evaluate((n) => {
      const ms = [...document.querySelectorAll(".ant-modal-wrap")].filter((m) => m.style.display !== "none" && /Berhasil/.test(m.innerText));
      const m = ms[ms.length - 1];
      if (!m) return null;
      const tx = m.innerText.replace(/\s+/g, " ");
      const b = /Berhasil\s*:?\s*(\d+)/.exec(tx), g = /Gagal\s*:?\s*(\d+)/.exec(tx);
      const B = b ? +b[1] : 0, G = g ? +g[1] : 0;
      if (B + G < n) return null;
      return { B, G, teks: tx.slice(0, 3000) };
    }, n).catch(() => null);
    if (r) return r;
  }
  return null;
}
const jsBaris = (tok) => `[...document.querySelectorAll('.list_items_out')].filter(x=>{const t=x.querySelector('.items_tit');return t&&t.textContent.indexOf(${JSON.stringify(tok)})>=0})`;

// Kirim satu bagian (tambah/kurang). Mengembalikan { ok, skuGagal:Set|null, pesan }.
async function kirimBagian(page, part, rows, buf, tok) {
  const L = NAMA[part];
  log(`=== ${L} stok: ${rows.length} SKU (catatan ${tok}) ===`);
  const file = `/tmp/raksa_${part}_${tok}.xlsx`;
  await fs.writeFile(file, buf);
  await bukaHalaman(page, part);
  await bukaImpor(page);
  await page.locator("xpath=//div[contains(@class,'ant-modal')]//textarea[contains(@class,'noteText')]").first().fill(tok);
  await page.locator("xpath=//div[contains(@class,'ant-modal')]//input[@type='file']").first().setInputFiles(file);
  await page.waitForTimeout(2000);
  if (MODE === "uji" && part === "tambah") {
    log("Uji: jendela impor penambahan terbuka dan file terpilih, dibatalkan tanpa impor");
    await page.locator("xpath=//div[contains(@class,'ant-modal')]//button[normalize-space()='Batalkan']").first().click().catch(() => {});
    return { ok: true, uji: true, pesan: "uji: jendela impor & file OK (dibatalkan)" };
  }
  await page.locator("xpath=//div[contains(@class,'ant-modal')]//button[normalize-space()='Impor']").first().click();
  const h = await bacaHasil(page, rows.length);
  if (!h) return { ok: false, skuGagal: null, pesan: `Jendela hasil impor ${L} tidak selesai. ${await teksJendela(page)}`.slice(0, 600) };
  log(`Hasil impor ${L}: berhasil ${h.B}, gagal ${h.G}`);
  const pesanImpor = h.teks;
  let skuGagal = null;
  if (h.G > 0) {
    const atas = pesanImpor.toUpperCase();
    skuGagal = new Set(rows.map((r) => r.sku).filter((s) => atas.includes(s.toUpperCase())));
    if (skuGagal.size !== h.G) skuGagal = null; // tidak bisa dipastikan SKU mana yang gagal
  }
  await page.locator("xpath=(//button[normalize-space()='Tutup'])[last()]").click().catch(() => {});
  if (MODE === "uji") return { ok: h.G > 0, uji: true, pesan: `uji: berhasil ${h.B}, gagal ${h.G}. ${pesanImpor.slice(0, 300)}` };
  if (h.B === 0) return { ok: false, skuGagal: skuGagal || new Set(rows.map((r) => r.sku)), pesan: `Semua ${L} ditolak BigSeller. ${pesanImpor.slice(0, 400)}` };
  if (h.G > 0 && !skuGagal)
    return { ok: false, skuGagal: null, pesan: `${L}: ${h.G} baris ditolak tapi SKU-nya tidak terbaca, batch "${tok}" TIDAK dikonfirmasi (masih Pending di BigSeller). ${pesanImpor.slice(0, 300)}` };

  // Konfirmasi baris batch di daftar Pending.
  await bukaHalaman(page, part);
  let klik = "BARIS:0";
  for (let j = 0; j < 10 && klik.startsWith("BARIS:"); j++) {
    await page.waitForTimeout(2000);
    klik = await page.evaluate(`(()=>{const rows=${jsBaris(tok)};if(rows.length!==1)return 'BARIS:'+rows.length;const ic=rows[0].querySelector('.item_action .bsicon_inbound, .item_action .bsicon_outbound');if(!ic)return 'IKON-TIDAK-ADA';ic.click();return 'KLIK'})()`);
  }
  let pesanKonf = "";
  if (klik === "KLIK") {
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const bs = [...document.querySelectorAll(".ant-modal-wrap button, .ant-modal-confirm button")].filter((b) => b.textContent.trim() === "Konfirmasi" && b.getBoundingClientRect().width > 0); if (bs.length) bs[bs.length - 1].click(); });
    await page.waitForTimeout(2500);
    pesanKonf = await teksJendela(page);
  }
  await page.waitForTimeout(2000);
  await bukaHalaman(page, part);
  const sisa = await page.evaluate(`${jsBaris(tok)}.length`).catch(() => -1);
  if (sisa !== 0) {
    const atas = (pesanKonf || "").toUpperCase();
    const sebut = rows.map((r) => r.sku).filter((s) => atas.includes(s.toUpperCase()));
    return { ok: false, skuGagal: null, pesan: `${L}: impor berhasil tapi BigSeller menolak konfirmasi (klik=${klik}). Batch "${tok}" masih Pending di BigSeller. ${sebut.length ? "SKU disebut: " + sebut.join(", ") + ". " : ""}${pesanKonf.slice(0, 300)}` };
  }
  return { ok: true, skuGagal, pesan: h.G ? `${L}: ${h.B} SKU masuk, ${h.G} ditolak (${[...skuGagal].join(", ")}). ${pesanImpor.slice(0, 200)}` : `${L}: ${h.B} SKU masuk` };
}

// ------------------------------------------------------------------ utama
async function main() {
  if (!URL_SB || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY belum diisi di GitHub Secrets.");
  const tunggal = await muatDok("_tunggal", "&id=eq.settings");
  const settings = (tunggal[0] && tunggal[0].data && tunggal[0].data.v) || {};
  if (MODE === "otomatis" && !settings.robot2Otomatis) { log("Robot 2 otomatis dimatikan di Raksa. Selesai tanpa mengirim."); return; }

  const semua = (await muatDok("movements")).map((r) => r.data).filter(Boolean);
  const siap = semua.filter((m) => m.status === "SIAP_IMPOR" && m.sku && m.qty > 0);
  const { penambahan, pengurangan } = rekap(siap, settings.eksporMode || "net");
  if (MODE !== "uji" && !penambahan.length && !pengurangan.length) {
    if (siap.length) await ubahPergerakan(siap, { status: "SUDAH_IMPOR", exportBatchId: "NET-0" });
    log(`Tidak ada penambahan/pengurangan stok untuk dikirim (${siap.length} pergerakan saling meniadakan). Selesai.`);
    return;
  }

  // Kunci bersama dengan Robot 2 UI.Vision supaya tidak jalan bersamaan.
  const k = await sb("/rest/v1/kunci?nama=eq.robot2&select=*");
  if (k && k[0] && k[0].sampai && new Date(k[0].sampai) > new Date() && k[0].dipegang_oleh !== OLEH) {
    await notif("Robot 2 tidak jalan", `Robot 2 sedang dipakai ${k[0].dipegang_oleh || "orang lain"}. Stok belum dikirim; jalankan ulang nanti.`);
    throw new Gagal(`Robot 2 sedang dipakai ${k[0].dipegang_oleh || "orang lain"}`);
  }
  await sb("/rest/v1/kunci?on_conflict=nama", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ nama: "robot2", dipegang_oleh: OLEH, user_id: null, sejak: new Date().toISOString(), sampai: new Date(Date.now() + 40 * 60e3).toISOString() }) });

  const tgl = new Date(Date.now() + 7 * 3600e3).toISOString();
  const stamp = tgl.slice(2, 10).replace(/-/g, "") + tgl.slice(11, 16).replace(":", "");
  const run = await catatRun({
    robot: "ROBOT2", sumber: "GITHUB", status: "BERJALAN", oleh: OLEH, log_url: LOG_URL,
    keterangan: MODE === "uji" ? "Uji Robot 2 (tanpa mengubah stok)" : `Kirim stok: ${penambahan.length} SKU tambah, ${pengurangan.length} SKU kurang`,
  });
  RUN_ID = run.id;
  log("Robot 2 mulai, run", run.id, "mode", MODE);

  let modal = {};
  if ((settings.hargaMode || "kosong") === "modal") (await muatDok("skuModal")).forEach((r) => { modal[r.id] = r.data && r.data.modal; });

  const browser = await chromium.launch({ headless: true });
  const sesi = await unduhSesi().catch(() => null);
  const context = await browser.newContext({
    locale: "id-ID", timezoneId: "Asia/Jakarta", acceptDownloads: true, viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    ...(sesi ? { storageState: sesi } : {}),
  });
  const page = await context.newPage();
  const ringkas = [];
  const ditahan = [];
  let adaGagal = false;
  try {
    if (!sesi) await login(page);
    const bagian = MODE === "uji"
      ? [["tambah", penambahan.length ? penambahan : [{ sku: "RAKSA-UJI", qty: 1 }]], ["kurang", [{ sku: "RAKSA-UJI-TIDAK-ADA-" + stamp, qty: 1 }]]]
      : [["tambah", penambahan], ["kurang", pengurangan]].filter(([, r]) => r.length);
    const sukses = { tambah: true, kurang: true };
    for (const [part, rows] of bagian) {
      const skuBagian = new Set(rows.map((r) => r.sku));
      const mvBagian = MODE === "uji" ? [] : siap.filter((m) => skuBagian.has(m.sku));
      const tok = `Raksa-R2-${stamp}-${part}`;
      await ubahPergerakan(mvBagian, { status: "DIKIRIM_ROBOT", robotRun: run.id });
      let h;
      try {
        h = await kirimBagian(page, part, rows, fileStok(part, rows, { hargaMode: settings.hargaMode, modal }), tok);
      } catch (e) {
        h = { ok: false, skuGagal: null, pesan: `${NAMA[part]}: robot berhenti (${String(e.message || e).slice(0, 200)}). Cek daftar Pending di BigSeller dengan catatan "${tok}".` };
      }
      log(h.pesan);
      ringkas.push(h.pesan);
      if (MODE === "uji") continue;
      const gagalSku = h.ok ? (h.skuGagal || new Set()) : (h.skuGagal || skuBagian);
      const mvGagal = mvBagian.filter((m) => gagalSku.has(m.sku));
      const mvOk = h.ok ? mvBagian.filter((m) => !gagalSku.has(m.sku)) : [];
      if (!h.ok) sukses[part] = false;
      if (mvGagal.length) {
        adaGagal = true;
        await ubahPergerakan(mvGagal, { status: "GAGAL_BIGSELLER", gagalPesan: h.pesan.slice(0, 500), gagalPada: new Date().toISOString(), robotRun: run.id });
        ditahan.push(...[...gagalSku].map((s) => `${s} (${NAMA[part].toLowerCase()} ${rows.find((r) => r.sku === s)?.qty ?? ""})`));
      }
      if (mvOk.length) await ubahPergerakan(mvOk, { status: "SUDAH_IMPOR", exportBatchId: `E-R2-${stamp}` });
    }
    if (MODE !== "uji") {
      // SKU yang tambah & kurangnya saling meniadakan (net 0) ikut selesai bila semua bagian berhasil.
      const sisaNet = siap.filter((m) => m.status === "SIAP_IMPOR");
      if (sukses.tambah && sukses.kurang && sisaNet.length) await ubahPergerakan(sisaNet, { status: "SUDAH_IMPOR", exportBatchId: `E-R2-${stamp}` });
      const selesai = siap.filter((m) => m.status === "SUDAH_IMPOR");
      if (selesai.length) {
        await simpanDok("exportBatches", [{ id: `E-R2-${stamp}`, waktu: new Date().toISOString(), oleh: OLEH, movementIds: selesai.map((m) => m.id),
          mode: settings.eksporMode || "net", jumlahSku: penambahan.length + pengurangan.length, penambahan, pengurangan, robotRun: run.id }]);
        // Kasus yang semua pergerakannya sudah diimpor → DIIMPOR (sama seperti tombol "Tandai sudah diimpor").
        const caseIds = [...new Set(selesai.map((m) => m.caseId).filter(Boolean))];
        if (caseIds.length) {
          const kasus = (await sb(`/rest/v1/dokumen?koleksi=eq.cases&dihapus=is.false&id=in.(${caseIds.map((c) => `"${c}"`).join(",")})&select=id,data`)) || [];
          const semuaBaru = (await muatDok("movements")).map((r) => r.data);
          const ubah = kasus.map((c) => c.data).filter((c) => c && c.status === "DISETUJUI" && !semuaBaru.some((m) => m.caseId === c.id && ["SIAP_IMPOR", "DIKIRIM_ROBOT", "GAGAL_BIGSELLER"].includes(m.status)))
            .map((c) => ({ ...c, status: "DIIMPOR" }));
          if (ubah.length) await simpanDok("cases", ubah);
        }
      }
    }
    await unggah(SESI_PATH, JSON.stringify(await context.storageState()), "application/json", SESI_BUCKET).catch(() => {});
    const hasil = ringkas.join(" | ").slice(0, 1500);
    await ubahRun(run.id, { status: adaGagal ? "GAGAL" : "BERHASIL", selesai: new Date().toISOString(), hasil, debug_img: null });
    if (adaGagal) await notif("Robot 2: ada stok yang gagal di BigSeller",
      `${ditahan.length ? ditahan.slice(0, 6).join(", ") + (ditahan.length > 6 ? ` +${ditahan.length - 6} lagi` : "") + ". " : ""}Ditahan di Raksa sampai Owner memutuskan. ${hasil.slice(0, 160)}`);
  } catch (e) {
    await page.screenshot({ path: "gagal.png", fullPage: true }).catch(() => {});
    const kecil = await page.screenshot({ type: "jpeg", quality: 45 }).catch(() => null);
    const pesan = e instanceof Gagal ? e.message : `Robot berhenti: ${String(e.message || e).slice(0, 300)}`;
    // Pergerakan yang belum sempat dikirim dikembalikan ke Siap impor (yang sudah DIKIRIM_ROBOT tetap, perlu dicek).
    await ubahRun(run.id, { status: "GAGAL", selesai: new Date().toISOString(), hasil: [pesan, ...ringkas].join(" | ").slice(0, 1500), captcha_img: null, ...(kecil ? { debug_img: "data:image/jpeg;base64," + kecil.toString("base64") } : {}) }).catch(() => {});
    if (MODE !== "uji") await notif("Robot 2 gagal", pesan.slice(0, 300));
    console.error(pesan);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await sb("/rest/v1/kunci?nama=eq.robot2", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dipegang_oleh: null, user_id: null, sejak: null, sampai: null }) }).catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
