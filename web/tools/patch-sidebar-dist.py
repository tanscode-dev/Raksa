#!/usr/bin/env python3
"""Menu kiri Raksa (13 Nov 2026): seluruh menu kiri, termasuk kotak "Business Manager",
ikut bergulir sebagai satu bagian — sama seperti Seller Fintech, PayrollKu dan Invoice.
Sebelumnya hanya daftar menu yang bergulir; kotak Business Manager diam di atas.
Pemakaian: python3 tools/patch-sidebar-dist.py dist/app.js
"""
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
lama = ('f.jsxs("aside",{className:"sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-brand-900 py-5 lg:flex",'
        'children:[f.jsx(W,{}),f.jsx(RaksaPindahAplikasi,{peran:n.peran}),f.jsx("nav",{className:"mt-5 flex-1 space-y-0.5 overflow-auto px-2",')
baru = ('f.jsxs("aside",{className:"sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-auto bg-brand-900 py-5 lg:flex","data-rk":"menu-kiri",'
        'children:[f.jsx(W,{}),f.jsx(RaksaPindahAplikasi,{peran:n.peran}),f.jsx("nav",{className:"mt-5 flex-1 space-y-0.5 px-2",')
if s.count(baru) == 1:
    sys.exit("[sidebar] sudah dipasang")
if s.count(lama) != 1:
    sys.exit(f"[sidebar] pola ditemukan {s.count(lama)}x, diharapkan 1x")
s = s.replace(lama, baru)
open(p, "w", encoding="utf-8").write(s)
print("[sidebar] selesai")
