#!/usr/bin/env python3
"""Format waktu Raksa: semua jam WIB (Asia/Jakarta, apa pun zona perangkat),
tanggal DD/MM/YYYY, tanggal+jam "04/11/2026 09.15 WIB".

Dijalankan langsung pada dist/app.js yang sedang live (4 Nov 2026), karena
dist/app.js berisi perubahan yang tidak semuanya ada di prototype/patch.py.
Setiap penggantian harus cocok tepat sebanyak yang diharapkan; kalau tidak, berhenti.
Tidak menyentuh robot (nama file robot, stempel waktu UI.Vision).

Pemakaian: python3 tools/patch-waktu-dist.py dist/app.js
"""
import sys

p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "function __wktWIB(" in s:
    sys.exit("[waktu] sudah dipasang")


def ganti(lama, baru, n=1, ket=""):
    global s
    c = s.count(lama)
    if c != n:
        sys.exit(f"[waktu] '{ket or lama[:60]}' ditemukan {c}x, diharapkan {n}x")
    s = s.replace(lama, baru)


BANTU = (
    'function __wibD(x){const t=new Date(x);return isNaN(t)?null:new Date(t.getTime()+252e5)}'
    'function __p2(n){return String(n).padStart(2,"0")}'
    'function __tglWIB(x){const u=__wibD(x);return u?__p2(u.getUTCDate())+"/"+__p2(u.getUTCMonth()+1)+"/"+u.getUTCFullYear():"-"}'
    'function __jamWIB(x){const u=__wibD(x);return u?__p2(u.getUTCHours())+"."+__p2(u.getUTCMinutes()):"-"}'
    'function __wktWIB(x){return x&&__wibD(x)?__tglWIB(x)+" "+__jamWIB(x)+" WIB":"-"}\n'
)

ganti('Dt=e8=>{if(!e8)return"-";const t=new Date(e8);return isNaN(t)?"-":`${zf(t.getDate())}/${zf(t.getMonth()+1)}/${t.getFullYear()}`}',
      'Dt=e8=>e8?__tglWIB(e8):"-"', ket="tanggal")
ganti('rn=e8=>{if(!e8)return"-";const t=new Date(e8);return isNaN(t)?"-":`${Dt(t)} ${zf(t.getHours())}:${zf(t.getMinutes())}`}',
      'rn=e8=>e8?__wktWIB(e8):"-"', ket="tanggal jam")
ganti('HN=e8=>{const t=new Date(e8);return`${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`}',
      'HN=e8=>__jamWIB(e8)', ket="jam")
ganti('${_X[+r-1]} ${t.slice(2)}`', '${_X[+r-1]} ${t}`', ket="label bulan (Nov 2026)")
ganti('i=u=>{if(!u)return"";const c=new Date(u),d=h=>String(h).padStart(2,"0");return`${d(c.getDate())} ${a[c.getMonth()]} ${c.getFullYear()} ${d(c.getHours())}:${d(c.getMinutes())}`}',
      'i=u=>u?__wktWIB(u):""', ket="waktu ekspor")
ganti('${new Date(r.terakhirTerlihat).toLocaleString("id-ID",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}',
      '${__wktWIB(r.terakhirTerlihat)}', ket="terakhir diimpor")
ganti('wkt=x=>{const d=new Date(x);return rkP2(d.getDate())+"/"+rkP2(d.getMonth()+1)+"/"+d.getFullYear()+" "+rkP2(d.getHours())+":"+rkP2(d.getMinutes())}',
      'wkt=x=>__wktWIB(x)', ket="riwayat robot manual")
ganti('fmt=x=>{if(!x)return"-";const d=new Date(x),p=n=>String(n).padStart(2,"0");return`${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`}',
      'fmt=x=>__wktWIB(x)', n=2, ket="riwayat Robot 1 & 2 otomatis")
ganti('function rkJamTgl(v){if(!v)return"";const t=new Date(v);return`${String(t.getDate()).padStart(2,"0")}/${String(t.getMonth()+1).padStart(2,"0")} ${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`}',
      'function rkJamTgl(v){return v?__wktWIB(v):""}', ket="jam pending")
ganti('width:118', 'width:150', n=3, ket="lebar kolom waktu")
ganti('sub:"Mengambil pesanan 3 hari terakhir dari BigSeller setiap Senin\\u2013Sabtu pukul 09.00 dan 13.00 WIB"',
      'sub:"Jadwal: Senin\\u2013Sabtu pukul 09.00 dan 13.00 WIB (pesanan 3 hari terakhir) \\xB7 Minggu pukul 10.00 WIB (30 hari terakhir, memperbarui status pesanan lama)"',
      ket="jadwal Robot 1")

s = BANTU + s
open(p, "w", encoding="utf-8").write(s)
print("[waktu] selesai")
