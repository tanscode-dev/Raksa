// Pembersihan foto bukti Hitung Barang (BM).
// Hanya foto label yang SUDAH dipakai, sudah dihitung ulang picker dan COCOK (selisih 0),
// dan dipakai lebih dari 90 hari lalu. Foto label yang ada selisih disimpan selamanya.
// Data angka label tidak dihapus — hanya file fotonya, lalu label ditandai "foto dihapus otomatis".
// Terpisah dari Robot 1 & Robot 2 (tidak menyentuh BigSeller maupun stok).
const URL_SB = (() => { const v = (process.env.SUPABASE_URL || "").trim(); try { return new URL(v).origin; } catch { return v.replace(/\/+$/, ""); } })();
const KEY = process.env.SUPABASE_SERVICE_KEY || "";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rpc(nama, arg) {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${nama}`, { method: "POST", headers: H, body: JSON.stringify(arg) });
  if (!r.ok) throw new Error(`${nama} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  if (!URL_SB || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY belum diisi.");
  let total = 0;
  for (let putaran = 0; putaran < 20; putaran++) {
    const daftar = await rpc("hc_foto_kedaluwarsa", { p_batas: 200 });
    if (!daftar.length) break;
    const paths = daftar.map((d) => d.foto_path).filter(Boolean);
    const r = await fetch(`${URL_SB}/storage/v1/object/hitung-foto`, { method: "DELETE", headers: H, body: JSON.stringify({ prefixes: paths }) });
    if (!r.ok) throw new Error(`hapus foto → ${r.status} ${await r.text()}`);
    const n = await rpc("hc_tandai_foto_dihapus", { p_paths: paths });
    total += Number(n) || 0;
    console.log(`Putaran ${putaran + 1}: ${paths.length} foto dihapus, ${n} label ditandai.`);
    if (daftar.length < 200) break;
  }
  console.log(`Selesai. ${total} foto label lama (cocok, >90 hari) dibersihkan.`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
