# Raksa 1.0

Kontrol kasus & stok untuk Dunia Gelang: konfirmasi, komplain, retur, barang rusak,
pending, denda karyawan, dan file penambahan/pengurangan stok BigSeller.

| Bagian | Tempat | Isi folder |
|---|---|---|
| Aplikasi web (PWA) | Vercel, project **raksa** → https://raksa-mu.vercel.app | `web/` |
| Database, login, file robot | Supabase, project **Raksa** (Singapura) | `supabase/` |
| Robot 1 (ambil pesanan otomatis) | GitHub Actions, Senin–Sabtu 09.00 & 13.00 WIB | `robot/`, `.github/workflows/robot1.yml` |
| Robot 2 (kirim stok ke BigSeller) | UI.Vision di Chrome, tombol di halaman Ekspor BigSeller | `web/public/peluncur.html` |

## Cara kerja data

* Setiap pesanan, kasus, pergerakan stok, SKU, dll. disimpan sebagai satu baris di tabel
  `dokumen`. Logika Raksa sama persis dengan prototype yang sudah disetujui.
* Aplikasi menyimpan cache di perangkat, jadi pembukaan berikutnya cepat dan hanya
  mengambil perubahan terbaru. Perubahan dari orang lain muncul langsung (realtime).
* Yang dimuat ke aplikasi: pesanan 120 hari terakhir + pesanan yang terkait kasus.
  Pesanan lama tetap bisa dicari lewat kotak pencarian.
* Harga modal disimpan terpisah dan hanya bisa dibaca akun Owner.
* Karyawan hanya bisa membaca Pending, master SKU/rak, dan **dendanya sendiri**.
* Pembersihan malam (02.15 WIB): pesanan > 13 bulan yang tidak terkait kasus, riwayat
  robot > 6 bulan, audit > 1 tahun.

## Login

Nama pengguna + kata sandi. Akun Owner pertama dibuat langsung di halaman pembuka
aplikasi. Akun lain dibuat Owner di menu **Akun Login** (nama akun harus sama dengan
nama di Master Data → Karyawan).

## Membangun ulang aplikasi web

```
cd web
npm install
bash build.sh        # hasil di web/dist (yang di-deploy Vercel)
```

`web/prototype/raksa-prototype-v15.js` adalah prototype yang disetujui. `web/tools/patch.py`
mengubahnya menjadi versi produksi (data dari server, login, ID unik per perangkat, dll.)
dan berhenti dengan pesan jelas kalau ada bagian yang tidak cocok.

Uji otomatis (pakai Supabase tiruan, tidak menyentuh data asli):
`node web/tests/uji.mjs <folder-site> <file-ekspor-bigseller.xlsx>`

## GitHub Secrets (Settings → Secrets and variables → Actions)

| Nama | Isi |
|---|---|
| `SUPABASE_URL` | `https://djvvnkvdmwyltdhjmoax.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API Keys → `service_role` (rahasia) |
| `BIGSELLER_EMAIL` | email sub-akun BigSeller khusus robot |
| `BIGSELLER_PASSWORD` | kata sandinya |
