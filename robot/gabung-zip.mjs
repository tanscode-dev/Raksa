// Ekspor BigSeller untuk rentang panjang (mis. 30 hari) bisa datang sebagai ZIP berisi
// beberapa file xlsx (dipotong per 20.000 baris). Raksa memproses satu file per jalan,
// dan satu pesanan bisa terpotong di dua file. Karena itu isi ZIP digabung lagi jadi
// SATU file xlsx dengan satu baris judul, baru dititipkan ke Raksa.
//
// Hanya dipakai bila file unduhan berupa ZIP berisi xlsx. Ekspor harian (3 hari) tetap
// satu file xlsx dan tidak melewati kode ini.

import zlib from "node:zlib";

/** Membaca isi ZIP (metode simpan & deflate) → [{ nama, isi: Buffer }]. */
export function bacaZip(buf) {
  const keluar = [];
  // Cari End of Central Directory dari belakang.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP rusak: penutup tidak ditemukan");
  const jumlah = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < jumlah; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP rusak: daftar isi tidak valid");
    const metode = buf.readUInt16LE(p + 10);
    const ukuranZip = buf.readUInt32LE(p + 20);
    const panjangNama = buf.readUInt16LE(p + 28);
    const panjangExtra = buf.readUInt16LE(p + 30);
    const panjangKomentar = buf.readUInt16LE(p + 32);
    const offsetLokal = buf.readUInt32LE(p + 42);
    const nama = buf.slice(p + 46, p + 46 + panjangNama).toString("utf8");
    p += 46 + panjangNama + panjangExtra + panjangKomentar;
    if (nama.endsWith("/")) continue;
    const lokalNama = buf.readUInt16LE(offsetLokal + 26);
    const lokalExtra = buf.readUInt16LE(offsetLokal + 28);
    const mulai = offsetLokal + 30 + lokalNama + lokalExtra;
    const data = buf.slice(mulai, mulai + ukuranZip);
    let isi;
    if (metode === 0) isi = Buffer.from(data);
    else if (metode === 8) isi = zlib.inflateRawSync(data);
    else throw new Error(`ZIP memakai metode kompresi ${metode} yang tidak didukung`);
    keluar.push({ nama, isi });
  }
  return keluar;
}

/** true bila buffer adalah ZIP yang berisi file .xlsx (bukan file xlsx itu sendiri). */
export function zipBerisiXlsx(buf) {
  if (!buf || buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) return false;
  try { return bacaZip(buf).some((f) => /\.xlsx$/i.test(f.nama)); } catch { return false; }
}

/** Menggabung semua xlsx di dalam ZIP jadi satu xlsx (sheet pertama tiap file). */
export async function gabungZipXlsx(buf) {
  const XLSX = (await import("xlsx")).default;
  const file = bacaZip(buf).filter((f) => /\.xlsx$/i.test(f.nama))
    .sort((a, b) => a.nama.localeCompare(b.nama, "en", { numeric: true }));
  if (!file.length) throw new Error("ZIP tidak berisi file xlsx");
  let judul = null;
  const baris = [];
  for (const f of file) {
    const wb = XLSX.read(f.isi, { type: "buffer", dense: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    if (!aoa.length) continue;
    if (!judul) judul = aoa[0];
    else if (JSON.stringify(aoa[0]) !== JSON.stringify(judul)) throw new Error(`Kolom file ${f.nama} berbeda dengan file pertama`);
    for (let i = 1; i < aoa.length; i++) baris.push(aoa[i]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([judul, ...baris]), "sheet1");
  // Ditulis tanpa kompresi, lalu dikemas ulang dengan zlib (jauh lebih kecil daripada kompresi bawaan SheetJS).
  const mentah = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: false, bookSST: true }));
  return { isi: tulisZip(bacaZip(mentah)), jumlahFile: file.length, jumlahBaris: baris.length };
}

const TABEL_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABEL_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Menulis ZIP (deflate zlib level 9) dari [{ nama, isi }]. */
export function tulisZip(file) {
  const bagian = [], pusat = [];
  let offset = 0;
  for (const f of file) {
    const nama = Buffer.from(f.nama, "utf8");
    const padat = zlib.deflateRawSync(f.isi, { level: 9 });
    const crc = crc32(f.isi);
    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0); lokal.writeUInt16LE(20, 4); lokal.writeUInt16LE(0x0800, 6);
    lokal.writeUInt16LE(8, 8); lokal.writeUInt32LE(0, 10); lokal.writeUInt32LE(crc, 14);
    lokal.writeUInt32LE(padat.length, 18); lokal.writeUInt32LE(f.isi.length, 22);
    lokal.writeUInt16LE(nama.length, 26); lokal.writeUInt16LE(0, 28);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10); dir.writeUInt32LE(0, 12); dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(padat.length, 20); dir.writeUInt32LE(f.isi.length, 24);
    dir.writeUInt16LE(nama.length, 28); dir.writeUInt32LE(offset, 42);
    bagian.push(lokal, nama, padat);
    pusat.push(dir, nama);
    offset += 30 + nama.length + padat.length;
  }
  const isiPusat = Buffer.concat(pusat);
  const akhir = Buffer.alloc(22);
  akhir.writeUInt32LE(0x06054b50, 0); akhir.writeUInt16LE(file.length, 8); akhir.writeUInt16LE(file.length, 10);
  akhir.writeUInt32LE(isiPusat.length, 12); akhir.writeUInt32LE(offset, 16);
  return Buffer.concat([...bagian, isiPusat, akhir]);
}
