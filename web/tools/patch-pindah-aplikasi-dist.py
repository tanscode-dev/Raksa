#!/usr/bin/env python3
"""Pindah aplikasi (kiri atas) hanya menampilkan aplikasi yang diizinkan untuk akun ini.
Daftar diambil dari fungsi database public.aplikasi_saya() (sama dengan Business Manager).
Dijalankan langsung pada dist/app.js (lihat catatan di patch-waktu-dist.py).
Pemakaian: python3 tools/patch-pindah-aplikasi-dist.py dist/app.js
"""
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "aplikasi_saya" in s:
    sys.exit("[pindah] sudah dipasang")
def ganti(lama, baru):
    global s
    c = s.count(lama)
    if c != 1:
        sys.exit(f"[pindah] '{lama[:60]}' ditemukan {c}x")
    s = s.replace(lama, baru)
ganti('function RaksaPindahAplikasi({peran}){if(peran==="KARYAWAN")return null;',
      'function RaksaPindahAplikasi({peran}){const[apps,setApps]=w.useState(null);'
      'w.useEffect(()=>{const R=window.__RAKSA;if(!R||!R.sb){setApps([]);return}'
      'R.sb.rpc("aplikasi_saya").then(({data})=>setApps(Array.isArray(data)?data:[]),()=>setApps([]))},[]);'
      'if(apps===null)return null;'
      'const KUNCI={"Seller Fintech":"seller",PayrollKu:"payroll","Invoice Manager":"invoice"};'
      'const daftar=RAKSA_APLIKASI.filter(([nama])=>!KUNCI[nama]||apps.includes(KUNCI[nama]));'
      'if(peran==="KARYAWAN"&&daftar.length<=2)return null;')
ganti('...RAKSA_APLIKASI.map(', '...daftar.map(')
open(p, "w", encoding="utf-8").write(s)
print("[pindah] selesai")
