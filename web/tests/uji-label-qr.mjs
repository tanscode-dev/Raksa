// Uji alur label QR di Pending Raksa (server tiruan + /api/hitung tiruan).
// Jalankan: PW_DIR=<folder node_modules playwright> node tests/uji-label-qr.mjs <folder-site>
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire(process.env.PW_DIR + "/");
const { chromium } = require("playwright");
const [site] = process.argv.slice(2);
const tipe = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]).replace(/^\/raksa/, "");
  if (p === "/" || p === "") p = "/index.html";
  const f = path.join(site, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": tipe[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(4318);

const gagal = [];
const cek = (k, m) => { console.log((k ? "  OK  " : "  GAGAL ") + m); if (!k) gagal.push(m); };
const formH0 = () => globalThis.__pg.locator('form:has-text("Verifikasi label QR")');
const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
const page = await ctxB.newPage();
globalThis.__pg = page;
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

// Label di "server BM" tiruan
const LABEL = {
  "HC-201126-AAAA": { kode: "HC-201126-AAAA", sku: "G11-HITAM-21", jumlah: 100, penghitung: "Agung Holid Jaelani", waktu: "20/11/2026 09.00 WIB", status: "AKTIF" },
  "HC-201126-BBBB": { kode: "HC-201126-BBBB", sku: "G11-HITAM-21", jumlah: 101, penghitung: "Nur Armelianti", waktu: "20/11/2026 09.10 WIB", status: "AKTIF" },
  "HC-201126-CCCC": { kode: "HC-201126-CCCC", sku: "CMIR-GOLD-18", jumlah: 100, penghitung: "Tian Oktaviani", waktu: "20/11/2026 09.20 WIB", status: "AKTIF" },
};
const api = [];
await page.route("**/api/hitung**", async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (req.method() === "GET") {
    const l = LABEL[u.searchParams.get("kode")] || null;
    return route.fulfill({ json: { label: l } });
  }
  const b = JSON.parse(req.postData() || "{}");
  api.push(b);
  const l = LABEL[b.kode];
  if (b.aksi === "pakai") {
    if (!l) return route.fulfill({ json: { ok: false, alasan: "Label tidak ditemukan" } });
    if (l.status === "DIPAKAI" && l.kasus !== b.kasus) return route.fulfill({ json: { ok: false, alasan: "Label sudah dipakai" } });
    l.status = "DIPAKAI"; l.kasus = b.kasus; l.dipakai_kasus = b.kasus;
    return route.fulfill({ json: { ok: true, label: l } });
  }
  return route.fulfill({ json: { ok: true } });
});

await page.addInitScript((tgl) => {
  const M = (window.__MOCK = { tabel: { profil: [], dokumen: [], denda_hitung: [], audit_log: [], robot_run: [], kunci: [] }, storage: {}, log: [], sesi: null });
  const doc = (koleksi, id, data) => M.tabel.dokumen.push({ koleksi, id, data, dihapus: false, diubah_pada: new Date().toISOString() });
  doc("skus", "G11-HITAM-21", { sku: "G11-HITAM-21", nama: "G11 Hitam 21", jual: 14800, aktif: true, gudangBesar: "GUDANG-426-G11-HITAM-21" });
  doc("cases", "K-0900-test", { id: "K-0900-test", jenis: "PENDING", nomor: "", tanggal: tgl + "T02:00:00.000Z", pic: "TIM", status: "BARU",
    items: [{ id: "P1", sku: "G11-HITAM-21", qty: 180, status: "MENUNGGU", waktu: tgl + "T02:00:00.000Z", entries: [{ waktu: tgl + "T02:00:00.000Z", qty: 180 }] }] });
}, hariIni);

await page.goto("http://127.0.0.1:4318/raksa/");
await page.waitForSelector("#rb-form", { timeout: 15000 });
await page.fill("input[name=u]", "TIM");
await page.fill("input[name=p]", "rahasia1");
await page.click("button[type=submit]");
await page.waitForSelector("aside", { timeout: 20000 });
await page.waitForTimeout(800);
await page.click('aside [data-nav="pending"]');
await page.waitForTimeout(800);
cek(await page.isVisible("text=G11-HITAM-21"), "Barang pending tampil");

// 1. Gudang memberikan barang: scan 2 label
await page.click("button:has-text('Ambilkan dari gudang')");
await page.waitForTimeout(400);
let adaScan = await page.isVisible("text=Label QR dari Hitung Barang");
if (!adaScan) {
  const tombol = await page.$$eval("li button", (bs) => bs.map((b) => b.textContent.trim()));
  console.log("     tombol di baris:", tombol.join(" | "));
}
cek(adaScan, "Form berikan dari gudang menampilkan scan label QR");
await page.screenshot({ path: "/tmp/uji-qr-1-kirim.png" });
const masukan = page.locator("input[placeholder^='Scan / ketik kode label']");
await masukan.fill("https://bm.example/hitung/#b?k=HC-201126-CCCC&s=CMIR");
await masukan.press("Enter");
await page.waitForTimeout(400);
console.log("     DEBUG api:", JSON.stringify(api), "errs:", errs.slice(-3).join(" | "));
console.log("     DEBUG teks:", (await page.locator("form").first().innerText()).slice(0,400).replace(/\n/g," / "));
cek(await page.isVisible("text=label ini untuk CMIR-GOLD-18"), "Label SKU lain ditolak");
await masukan.fill("hc-201126-aaaa");
await masukan.press("Enter");
await page.waitForTimeout(300);
await masukan.fill("HC-201126-BBBB");
await masukan.press("Enter");
await page.waitForTimeout(300);
cek(await page.isVisible("text=Total 201 pcs"), "Dua label terkumpul, total 201 pcs");
await masukan.fill("HC-201126-AAAA");
await masukan.press("Enter");
await page.waitForTimeout(300);
cek(await page.isVisible("text=sudah ada di daftar"), "Label dobel ditolak");
await page.evaluate(()=>window.scrollBy(0,350));await page.screenshot({ path: "/tmp/uji-qr-2-kirim-isi.png" });
await page.click("form button[type=submit]:has-text('Simpan')");
await page.waitForTimeout(1200);
const item1 = await page.evaluate(() => window.__RAKSA && window.__RAKSA.db ? null : null);
const pakai = api.filter((x) => x.aksi === "pakai").map((x) => x.kode);
cek(pakai.length === 2 && pakai.includes("HC-201126-AAAA") && pakai.includes("HC-201126-BBBB"), "Kedua label ditandai dipakai di server (" + pakai.join(",") + ")");
cek(await page.isVisible("text=2 label QR"), "Baris pending bertanda 2 label QR");
await page.screenshot({ path: "/tmp/uji-qr-3-dikirim.png" });

// 2. Picker menghitung: scan ulang + hitung per pack
await page.click("button:has-text('Hitung barang dari gudang')");
await page.waitForTimeout(400);
cek(await page.isVisible("text=Verifikasi label QR"), "Form hitung picker meminta verifikasi label");
cek(!(await page.isVisible("text=Nama penghitung yang tertulis di label")), "Pilihan nama penghitung manual disembunyikan (otomatis dari label)");
await formH0().locator("button[type=submit]:has-text('Simpan')").click();
await page.waitForTimeout(300);
cek(await page.isVisible("text=Scan ulang label dulu"), "Simpan ditolak sebelum label di-scan ulang");
const ulang = page.locator("input[placeholder^='Scan ulang label pack']");
await ulang.fill("HC-201126-CCCC"); await ulang.press("Enter"); await page.waitForTimeout(200);
cek(await page.isVisible("text=bukan label pack ini"), "Scan label lain saat verifikasi ditolak");
await ulang.fill("HC-201126-AAAA"); await ulang.press("Enter"); await page.waitForTimeout(200);
await ulang.fill("HC-201126-BBBB"); await ulang.press("Enter"); await page.waitForTimeout(200);
const hit = page.locator("input[placeholder='hitungan']");
await hit.nth(0).fill("99");
await hit.nth(1).fill("101");
await page.waitForTimeout(200);
// nama penghitung rak (wajib)
const formH = page.locator('form:has-text("Verifikasi label QR")');
for (const sel of await formH.locator("select").all()) { const v = await sel.inputValue(); if (!v) await sel.selectOption({ index: 1 }).catch(() => {}); }
await formH.scrollIntoViewIfNeeded();await page.evaluate(()=>window.scrollBy(0,250));await page.screenshot({ path: "/tmp/uji-qr-4-hitung.png" });
await formH.locator("button[type=submit]:has-text('Simpan')").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/uji-qr-5-hasil.png" });
const hasil = api.filter((x) => x.aksi === "hasil").map((x) => x.kode + "=" + x.hitung);
cek(hasil.includes("HC-201126-AAAA=99") && hasil.includes("HC-201126-BBBB=101"), "Hasil hitung per pack terkirim ke laporan (" + hasil.join(",") + ")");
const dok = await page.evaluate(() => {
  const c = window.__MOCK.tabel.dokumen.find((d) => d.koleksi === "cases" && d.id === "K-0900-test");
  return c && c.data.items[0];
});
console.log("     item:", JSON.stringify({ status: dok.status, label: dok.labelQty, terima: dok.qtyDiterima, awal: dok.penghitungAwal, packs: dok.packs, sumber: dok.labelSumber }));
cek(dok && dok.labelQty === 201 && dok.qtyDiterima === 200 && dok.status === "SELISIH", "Data pending tersimpan: label 201, diterima 200, SELISIH");
cek(dok && Array.isArray(dok.packs) && dok.packs.length === 2, "Hitungan per pack tersimpan");
await page.waitForTimeout(2500);
const denda = await page.evaluate(() => window.__MOCK.tabel.denda_hitung.map((d) => [d.id, d.orang, d.data && d.data.qty, d.data && d.data.nilai]));
console.log("     denda:", JSON.stringify(denda));
cek(denda.some((d) => /P1-HC-201126-AAAA$/.test(d[0]) && /AGUNG/.test(d[1]) && d[2] === 1), "Denda 1 pcs jatuh ke penghitung pack yang kurang (Agung)");
cek(!denda.some((d) => /BBBB/.test(d[0]) && d[3] > 0), "Pack yang cocok tidak didenda");

const errPenting = errs.filter((e) => !/serviceWorker|Failed to load resource|fonts\.g|ERR_|bm-bar|versi\.js|captcha/.test(e));
errPenting.forEach((e) => console.log("     " + e.slice(0, 300)));
cek(errPenting.length === 0, "Tidak ada error JavaScript");
await browser.close();
srv.close();
console.log(gagal.length ? `\n${gagal.length} uji gagal` : "\nSemua uji lulus");
process.exit(gagal.length ? 1 : 0);
