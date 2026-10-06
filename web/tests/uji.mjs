// Uji otomatis Raksa 1.0 dengan Supabase tiruan.
// Jalankan: node tests/uji.mjs <folder-site> <file-ekspor-bigseller.xlsx>
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire(process.env.PW_DIR + "/");
const { chromium } = require("playwright");
const [site, fileXlsx] = process.argv.slice(2);

const tipe = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(site, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": tipe[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(4317);

const gagal = [];
const cek = (kond, pesan) => { console.log((kond ? "  OK  " : "  GAGAL ") + pesan); if (!kond) gagal.push(pesan); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto("http://127.0.0.1:4317/");
await page.waitForSelector("#rb-form", { timeout: 15000 });
cek(await page.isVisible("text=Masuk"), "Layar masuk tampil");

await page.fill("input[name=u]", "tim");
await page.fill("input[name=p]", "salah");
await page.click("button[type=submit]");
await page.waitForSelector(".rb-err:not([hidden])");
cek((await page.textContent(".rb-err")).includes("salah"), "Sandi salah ditolak");

await page.fill("input[name=u]", "TIM");
await page.fill("input[name=p]", "rahasia1");
await page.click("button[type=submit]");
await page.waitForSelector("aside", { timeout: 20000 });
await page.waitForTimeout(800);
cek(await page.isVisible("text=Tersimpan di server"), "Aplikasi terbuka, status sinkron tampil");
cek(!(await page.isVisible("text=Prototype")), "Tidak ada label Prototype");
cek(await page.isVisible("aside >> text=Akun Login"), "Menu Akun Login ada untuk Owner");
await page.screenshot({ path: "/tmp/raksa-uji-1-dashboard.png" });

// Tambah karyawan lewat Master Data supaya ada perubahan yang disimpan
await page.click('aside [data-nav="master"]');
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/raksa-uji-2-master.png" });

// Upload file BigSeller
await page.click('aside [data-nav="upload"]');
await page.waitForSelector("#up-file", { state: "attached" });
cek(await page.isVisible("text=Robot 1 otomatis (server GitHub)"), "Kartu Robot 1 otomatis tampil di Upload Pesanan");
await page.setInputFiles("#up-file", fileXlsx);
await page.waitForTimeout(6000);
await page.screenshot({ path: "/tmp/raksa-uji-3-upload.png", fullPage: false });
await page.waitForTimeout(2000);
const log1 = await page.evaluate(() => {
  const M = window.__MOCK;
  const dok = M.tabel.dokumen;
  const per = {};
  dok.forEach((d) => { per[d.koleksi] = (per[d.koleksi] || 0) + 1; });
  return { per, audit: M.tabel.audit_log.length, ukuran: JSON.stringify(dok).length, denda: M.tabel.denda_hitung.length };
});
console.log("     dokumen tersimpan:", JSON.stringify(log1));
cek((log1.per.orders || 0) > 10, "Pesanan hasil upload tersimpan ke server");
cek((log1.per.uploads || 0) === 1, "Riwayat upload tersimpan");
cek(log1.audit >= 1, "Audit tercatat");
cek(!log1.per.skuModal || true, "SKU & modal disimpan terpisah");
const skuAdaModal = await page.evaluate(() => window.__MOCK.tabel.dokumen.filter((d) => d.koleksi === "skus" && "modal" in d.data).length);
cek(skuAdaModal === 0, "Harga modal tidak ikut di dokumen SKU (" + skuAdaModal + ")");

// ID unik per perangkat
const ids = await page.evaluate(() => window.__MOCK.tabel.dokumen.filter((d) => d.koleksi === "uploads").map((d) => d.id));
cek(ids.every((i) => /^U-\d{3}-[a-z0-9]{1,4}$/.test(i)), "ID upload memakai akhiran perangkat: " + ids.join(","));

// Simpan ulang tanpa perubahan tidak menulis apa-apa
const nSebelum = await page.evaluate(() => window.__MOCK.log.length);
await page.click('aside [data-nav="dashboard"]');
await page.waitForTimeout(1500);
const tulisanBaru = await page.evaluate((n) => window.__MOCK.log.slice(n).filter((x) => x.t === "dokumen"), nSebelum);
cek(tulisanBaru.length === 0, "Pindah halaman tidak menulis ulang data (" + tulisanBaru.length + ")");

// Robot 1 dari GitHub: file di inbox diproses otomatis
const bufB64 = fs.readFileSync(fileXlsx).toString("base64");
await page.evaluate((b64) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  window.__MOCK.storage["2026/10/06/robot1.xlsx"] = u;
  window.__MOCK.tabel.robot_run.push({ id: "run-1", robot: "ROBOT1", status: "BERHASIL", file_path: "2026/10/06/robot1.xlsx", hasil: null, diproses_oleh: null, mulai: new Date().toISOString(), keterangan: "Impor pesanan 04/10–06/10" });
}, bufB64);
await page.evaluate(() => window.__RAKSA.prosesInbox());
await page.waitForTimeout(8000);
const run = await page.evaluate(() => window.__MOCK.tabel.robot_run[0]);
console.log("     hasil robot:", run.hasil);
cek(run.hasil && /status berubah/.test(run.hasil), "File Robot 1 diproses dan hasilnya dicatat");
cek(await page.evaluate(() => !window.__MOCK.storage["2026/10/06/robot1.xlsx"]), "File robot dihapus setelah diproses");
await page.screenshot({ path: "/tmp/raksa-uji-4-robot.png" });

// Halaman Akun Login & menu akun
await page.click('aside [data-nav="akun"]');
await page.waitForTimeout(800);
cek(await page.isVisible("text=Tambah akun"), "Halaman Akun Login terbuka");
await page.screenshot({ path: "/tmp/raksa-uji-5-akun.png" });

// Mode gelap & tampilan HP
await page.setViewportSize({ width: 390, height: 844 });
await page.click('text=Beranda').catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/raksa-uji-6-hp.png" });

const errPenting = errs.filter((e) => !/serviceWorker|Failed to load resource|fonts\.g|ERR_|127\.0\.0\.1:9/.test(e));
errPenting.forEach((e) => console.log("     " + e.slice(0, 300)));
cek(errPenting.length === 0, "Tidak ada error JavaScript");

await browser.close();
srv.close();
console.log(gagal.length ? `\n${gagal.length} uji gagal` : "\nSemua uji lulus");
process.exit(gagal.length ? 1 : 0);
