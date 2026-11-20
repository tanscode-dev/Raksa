#!/usr/bin/env python3
"""Raksa per usaha (20/11/2026): data Raksa dipisah per usaha BM.

- profil ikut membawa company_id (usaha aktif di BM)
- cache di perangkat dipisah per usaha (Dunia Gelang tetap memakai kunci cache lama
  supaya antrean perubahan yang belum terkirim tidak hilang)
- simpan dokumen & denda memakai kunci baru (company_id, ...); company_id diisi server
- naik versi
"""
import sys, pathlib

DIST = pathlib.Path(__file__).resolve().parent.parent / "dist"
LAMA, BARU = "1.0.2611201150", sys.argv[1] if len(sys.argv) > 1 else "1.0.2611201330"
DG = "fdd98c7e-d5a6-4ffa-b482-6d0d32f1bf49"

def ganti(teks, a, b, n=1):
    c = teks.count(a)
    if c != n:
        raise SystemExit(f"Potongan ditemukan {c}x (harus {n}x): {a[:90]}")
    return teks.replace(a, b)

p = DIST / "boot.js"
s = p.read_text(encoding="utf-8")
s = ganti(s, 'B.from("profil").select("user_id,username,nama,akses,aktif")',
             'B.from("profil").select("user_id,username,nama,akses,aktif,company_id")')
s = ganti(s, 'o=`raksa:${e.id}:v${So}`',
             f'o=`raksa:${{e.id}}:v${{So}}`+(r.company_id&&r.company_id!=="{DG}"?":"+r.company_id:"")')
s = ganti(s, 'upsert(m,{onConflict:"koleksi,id"})', 'upsert(m,{onConflict:"company_id,koleksi,id"})')
s = ganti(s, 'upsert(_.slice(m,m+400),{onConflict:"id"})', 'upsert(_.slice(m,m+400),{onConflict:"company_id,id"})')
s = ganti(s, f'es="{LAMA}"', f'es="{BARU}"')
p.write_text(s, encoding="utf-8")

for f in ["sw.js", "index.html", "raksa/index.html"]:
    q = DIST / f
    t = q.read_text(encoding="utf-8")
    if t.count(LAMA) < 1:
        raise SystemExit(f"Versi lama tidak ada di {f}")
    q.write_text(t.replace(LAMA, BARU), encoding="utf-8")
print("OK", BARU)
