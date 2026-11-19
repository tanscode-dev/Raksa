"""Raksa · Semua kolom tanggal dd/mm/yyyy (19 Nov 2026): kolom <input type=date> bawaan browser
(tampil mm/dd/yyyy bila browser berbahasa Inggris) diganti kotak teks dd/mm/yyyy + tombol kalender
(tools/tanggal-dmy.js, ditempel di akhir app.js). Teks periode gaji di denda memakai "November 2026"."""
import pathlib
T = pathlib.Path(__file__).resolve().parent
D = T.parent / "dist"
def ganti(s, a, b, n=1):
    assert s.count(a) == n, (a[:90], s.count(a)); return s.replace(a, b)
p = D / "app.js"; s = p.read_text()
if "window.__tglDmy" in s:
    print("sudah"); raise SystemExit
s = ganti(s, '${y.periodeGaji?" \\xB7 gaji "+y.periodeGaji:""}', '${y.periodeGaji?" \\xB7 gaji "+Hn(y.periodeGaji):""}')
s = ganti(s, 'children:`Ditunda dari gaji ${y.ditundaDari||"-"}`', 'children:`Ditunda dari gaji ${y.ditundaDari?Hn(y.ditundaDari):"-"}`')
s = s.rstrip() + "\n;" + (T / "tanggal-dmy.js").read_text() + "\n"
p.write_text(s); print("ok")
