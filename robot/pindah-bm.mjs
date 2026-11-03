// Sekali jalan saat Raksa pindah ke database Business Manager:
// menyalin sesi login BigSeller (robot-sesi) dan file robot yang belum diproses (robot-inbox)
// dari Supabase Raksa lama ke Supabase Business Manager. Data lama tidak diubah.
for (const k of ["LAMA_URL", "LAMA_KEY", "BARU_URL", "BARU_KEY"]) console.log(k, (process.env[k] || "").trim() ? "terisi" : "KOSONG");
const asal = (v) => { v = (v || "").trim(); try { return new URL(v).origin; } catch { return v.replace(/\/+$/, ""); } };
const LAMA = { url: asal(process.env.LAMA_URL), key: (process.env.LAMA_KEY || "").trim() };
const BARU = { url: asal(process.env.BARU_URL), key: (process.env.BARU_KEY || "").trim() };
const H = (k, x = {}) => ({ apikey: k, Authorization: `Bearer ${k}`, ...x });

async function daftar(sb, bucket, prefix) {
  const r = await fetch(`${sb.url}/storage/v1/object/list/${bucket}`, {
    method: "POST", headers: H(sb.key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefix, limit: 1000 }),
  });
  if (!r.ok) throw new Error(`daftar ${bucket}/${prefix}: ${r.status} ${await r.text()}`);
  return (await r.json()).filter((f) => f.id).map((f) => (prefix ? `${prefix}/` : "") + f.name);
}
async function salin(bucket, path) {
  const r = await fetch(`${LAMA.url}/storage/v1/object/${bucket}/${path}`, { headers: H(LAMA.key) });
  if (!r.ok) { console.log(`lewati ${bucket}/${path}: ${r.status}`); return; }
  const isi = Buffer.from(await r.arrayBuffer());
  const u = await fetch(`${BARU.url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST", headers: H(BARU.key, { "Content-Type": r.headers.get("content-type") || "application/octet-stream", "x-upsert": "true" }), body: isi,
  });
  if (!u.ok) throw new Error(`unggah ${bucket}/${path}: ${u.status} ${await u.text()}`);
  console.log(`disalin ${bucket}/${path} (${Math.round(isi.length / 1024)} KB)`);
}
for (const [bucket, prefix] of [["robot-sesi", ""], ["robot-inbox", "pesanan"]]) {
  for (const p of await daftar(LAMA, bucket, prefix)) await salin(bucket, p);
}
// Cek kunci baru bisa membaca tabel robot_run di Business Manager.
const c = await fetch(`${BARU.url}/rest/v1/robot_run?select=id&limit=1`, { headers: H(BARU.key) });
console.log("cek robot_run Business Manager:", c.status);
if (!c.ok) process.exit(1);
