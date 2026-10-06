// Raksa Robot 1 — ambil pesanan BigSeller (Ekspor Semua Pesanan, per Sub SKU Gudang)
// lalu titipkan file ke Supabase Storage. Raksa memprosesnya saat aplikasi dibuka.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const env = (k, wajib = true) => { const v = process.env[k]; if (wajib && !v) throw new Error(`Secret ${k} belum diisi`); return v; };
const SB_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SB_KEY = env('SUPABASE_SERVICE_KEY');
const BS_EMAIL = env('BIGSELLER_EMAIL');
const BS_PASS = env('BIGSELLER_PASSWORD');
const HARI = Number(process.env.RAKSA_HARI || 3); // ambil pesanan N hari terakhir (Raksa tidak menggandakan)
const ORDER_URL = 'https://www.bigseller.com/web/order/index.htm?status=all';

const tgl = (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10); // tanggal WIB
const sekarang = new Date();
const sampai = tgl(sekarang);
const dari = tgl(new Date(sekarang.getTime() - (HARI - 1) * 86400e3));
const judul = `Impor pesanan BigSeller ${dari.split('-').reverse().join('/')} s/d ${sampai.split('-').reverse().join('/')} (otomatis)`;

async function sb(path, opt = {}) {
  const r = await fetch(`${SB_URL}${path}`, { ...opt, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`);
  return r;
}
async function catat(id, isi) {
  if (!id) {
    const r = await sb('/rest/v1/robot_run', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ robot: 'ROBOT1', sumber: 'github', judul, ...isi }) });
    return (await r.json())[0].id;
  }
  await sb(`/rest/v1/robot_run?id=eq.${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isi) });
  return id;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'id-ID', timezoneId: 'Asia/Jakarta', acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let runId = null;
try {
  runId = await catat(null, { status: 'PROSES', detail: 'Robot GitHub mulai.' });

  // 1. Login (hanya bila diarahkan ke halaman login)
  await page.goto(ORDER_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const pass = page.locator('input[type=password]:visible').first();
  if (await pass.count()) {
    const user = page.locator('input[type=email]:visible, input[type=text]:visible, input[type=tel]:visible').first();
    await user.fill(BS_EMAIL);
    await pass.fill(BS_PASS);
    await page.locator('button:visible').filter({ hasText: /^(Masuk|Login|Log In|Sign In)$/i }).first().click();
    await page.waitForTimeout(6000);
    if (await page.locator('input[type=password]:visible').count()) throw new Error('Login BigSeller gagal (mungkin diminta OTP/captcha). Lihat screenshot di GitHub Actions.');
    await page.goto(ORDER_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  }

  // 2. Filter Waktu Pesanan Dibuat
  await page.locator("input.ant-calendar-range-picker-input[placeholder='Waktu Mulai']").click();
  await page.waitForTimeout(900);
  await page.locator("input.ant-calendar-input[placeholder='Waktu Mulai']").fill(`${dari} 00:00:00`);
  await page.locator("input.ant-calendar-input[placeholder='Waktu Berakhir']").fill(`${sampai} 23:59:59`);
  await page.waitForTimeout(500);
  await page.locator('a.ant-calendar-ok-btn').click();
  await page.waitForTimeout(4000);

  // 3. Ekspor > Ekspor Semua Pesanan (menu hanya terbuka lewat hover)
  const ekspor = page.locator('button.ant-btn', { hasText: /^Ekspor$/ }).first();
  await ekspor.hover();
  await page.waitForTimeout(1200);
  const item = page.locator('span.dropdown_content').getByText('Ekspor Semua Pesanan', { exact: true }).last();
  if (!(await item.isVisible().catch(() => false))) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('button.ant-btn')].find(x => x.textContent.trim() === 'Ekspor'); let v = b && b.closest('.ant-dropdown-trigger')?.__vue__; for (let i = 0; v && i < 6; i++) { if (typeof v.setPopupVisible === 'function') { v.setPopupVisible(true); break } v = v.$parent } });
    await page.waitForTimeout(1200);
  }
  await item.click();
  await page.waitForTimeout(2500);

  // 4. Jenis Ekspor = Sub SKU Gudang
  await page.locator('.ant-modal .ant-select-selection-selected-value').click();
  await page.waitForTimeout(800);
  await page.locator('li.ant-select-dropdown-menu-item', { hasText: 'Ekspor Berdasarkan Sub SKU Gudang' }).click();
  await page.waitForTimeout(800);
  await page.locator('.ant-modal button.ant-btn', { hasText: /^Ekspor$/ }).click();

  // 5. Tunggu Ekspor Selesai lalu Unduh
  await page.getByText('Ekspor Selesai').first().waitFor({ timeout: 300000 });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('a.ant-btn', { hasText: /^Unduh$/ }).click()]);
  const lokal = `/tmp/${dl.suggestedFilename() || 'pesanan.xlsx'}`;
  await dl.saveAs(lokal);
  const isi = await fs.readFile(lokal);

  // 6. Titipkan ke Supabase Storage
  const path = `${sampai}/${Date.now()}-${(dl.suggestedFilename() || 'pesanan.xlsx').replace(/[^\w.-]/g, '_')}`;
  await sb(`/storage/v1/object/robot-pesanan/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x-upsert': 'true' }, body: isi });
  await catat(runId, { status: 'PROSES', file_path: path, detail: `File ${(isi.length / 1024).toFixed(0)} KB menunggu diproses saat Raksa dibuka.` });
  console.log('Selesai:', path);
} catch (e) {
  console.error(e);
  await page.screenshot({ path: 'gagal.png', fullPage: true }).catch(() => {});
  await catat(runId, { status: 'GAGAL', selesai: new Date().toISOString(), detail: String(e.message || e).slice(0, 500) }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
