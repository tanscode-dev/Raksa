# Raksa 1.0

Isi repo ini:

- `supabase/001_skema_raksa.sql` — skema database Raksa (dipasang oleh Claude lewat konektor Supabase).
- `robot/` — Robot 1 (Playwright): mengambil pesanan BigSeller dan menitipkan file ke Supabase.
- `.github/workflows/robot1.yml` — jadwal Robot 1: 09.00 & 13.00 WIB, Senin–Sabtu.
- `web/` — aplikasi Raksa (menyusul).

## GitHub Secrets yang wajib diisi (Settings → Secrets and variables → Actions)

| Nama | Isi |
| --- | --- |
| `SUPABASE_URL` | URL project Supabase `raksa` |
| `SUPABASE_SERVICE_KEY` | *service_role key* project `raksa` (Supabase → Project Settings → API Keys) |
| `BIGSELLER_EMAIL` | email sub-akun BigSeller khusus robot |
| `BIGSELLER_PASSWORD` | password sub-akun tersebut |

Menjalankan manual: tab **Actions → Robot 1 - Ambil pesanan BigSeller → Run workflow**.
Kalau gagal, screenshot halaman terakhir tersedia di bagian *Artifacts* run tersebut.
