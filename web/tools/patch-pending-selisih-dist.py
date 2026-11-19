"""Raksa · Kartu "barang pending jumlahnya tidak sesuai label" menampilkan rinciannya (19 Nov 2026):
tombol "Lihat rincian" membuka daftar per barang — SKU, label vs hitungan rak, selisih, penghitung label
(yang dikenai), penghitung ulang, tanggal & nomor kasus. Klik SKU → halaman Pending."""
import pathlib
D = pathlib.Path(__file__).resolve().parent.parent / "dist"
def ganti(s, a, b, n=1):
    assert s.count(a) == n, (a[:90], s.count(a)); return s.replace(a, b)
p = D / "app.js"; s = p.read_text()
if "rkSelisihDaftar" in s:
    print("sudah"); raise SystemExit
s = ganti(s,
  'const h=t.filter(k=>k.jenis==="PENDING").flatMap(k=>(k.items||[]).filter(y=>y.status==="SELISIH"));h.length&&l.push({untuk:"OWNER",level:"bad",judul:`${h.length} barang pending jumlahnya tidak sesuai label`,apa:"Hitungan rak beda dengan label pack. Sudah tercatat atas nama penghitung di label.",aksi:"Lihat Pending",page:"pending"});',
  'const rkSelisihDaftar=t.filter(k=>k.jenis==="PENDING").flatMap(k=>(k.items||[]).filter(y=>y.status==="SELISIH").map(y=>({k,y}))),h=rkSelisihDaftar;h.length&&l.push({untuk:"OWNER",level:"bad",judul:`${h.length} barang pending jumlahnya tidak sesuai label`,apa:"Hitungan rak beda dengan label pack. Sudah tercatat atas nama penghitung di label.",aksi:"Lihat rincian",page:"pending",daftar:h.map(({k,y})=>{const lb=+y.labelQty||0,dh=y.qtyDiterima==null?null:+y.qtyDiterima,sl=dh==null?null:dh-lb,tg=y.waktuTerima||y.waktu||k.tanggal,tgs=tg?new Date(tg).toLocaleDateString("id-ID",{timeZone:"Asia/Jakarta",day:"2-digit",month:"2-digit",year:"numeric"}):"-";return{key:k.id+":"+y.id,nomor:y.sku,page:"pending",ket:`label ${lb} pcs \\xB7 dihitung di rak ${dh==null?"-":dh} pcs${sl==null?"":` (${sl>0?"+":""}${sl})`} \\xB7 penghitung label: ${y.penghitungAwal||"-"}${y.penghitungRak?` \\xB7 dihitung ulang: ${y.penghitungRak}`:""} \\xB7 ${tgs} \\xB7 ${k.id}`}})});')
s = ganti(s,
  'children:o.daftar.map(c=>f.jsxs("li",{children:[f.jsx("button",{onClick:()=>i(c.nomor),className:"font-mono text-[12.5px] text-brand-700 underline",children:c.nomor})," ",f.jsx("span",{className:"text-[12px] text-n-700",children:c.ket})]},c.nomor))',
  'children:o.daftar.map(c=>f.jsxs("li",{children:[f.jsx("button",{onClick:()=>c.page?a(c.page):i(c.nomor),className:"font-mono text-[12.5px] text-brand-700 underline",children:c.nomor})," ",f.jsx("span",{className:"text-[12px] text-n-700",children:c.ket})]},c.key||c.nomor))')
p.write_text(s); print("ok")
