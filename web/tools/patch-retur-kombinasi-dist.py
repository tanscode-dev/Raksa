"""Raksa · Retur barang kombinasi (box) dibandingkan per komponen (19 Nov 2026).
Pesanan box tercatat per komponen (mis. 1BOX-CS-29-GOLD-(15-19) = 36 pcs komponen), dan Stock-In
BigSeller juga per komponen. Dulu retur yang dicatat sebagai box ×1 dibandingkan apa adanya →
"kembali 1, padahal dikirim 0" dan "Stock-In 36 pcs, seharusnya 1 pcs". Sekarang baris retur SKU
kombinasi (punya resep) diuraikan ke komponennya (qty × resep) saat dibandingkan — kecuali box itu
sendiri yang tercatat di pesanan, atau kondisi "sebagian rusak" (jumlah rusak dicatat per box).
Data retur yang tersimpan tidak diubah."""
import pathlib
D = pathlib.Path(__file__).resolve().parent.parent / "dist"
def ganti(s, a, b, n=1):
    assert s.count(a) == n, (a[:90], s.count(a)); return s.replace(a, b)
p = D / "app.js"; s = p.read_text()
if "rkUraiKomb" in s:
    print("sudah"); raise SystemExit
s = ganti(s,
  'rows=bukan?[]:(c.kembali||[]).filter(r=>r.sku&&+r.qty>0).map(r=>{const qty=+r.qty||0,layak=rkLayak(r,c.kondisi)',
  'rkUraiKomb=(c.kembali||[]).filter(r=>r.sku&&+r.qty>0).flatMap(r=>{const kk=Object.entries((komb[r.sku]||{}).komponen||{}).filter(([s,q])=>s&&+q>0);if(!kk.length||c.kondisi==="SEBAGIAN_RUSAK"||a.o&&(dipesan[r.sku]||0)>0&&!kk.every(([s])=>s in dipesan))return[r];return kk.map(([s,q])=>({...r,sku:s,qty:(+r.qty||0)*(+q||0),rusak:0,dariKomb:r.sku}))}),rows=bukan?[]:rkUraiKomb.map(r=>{const qty=+r.qty||0,layak=rkLayak(r,c.kondisi)')
s = ganti(s,
  'return{sku:r.sku,qty,layak,rusak:qty-layak,diPesanan:di2,via:layak>0?lewatBS&&di2?"BIGSELLER":"RAKSA":null}}),harusBS=',
  'return{sku:r.sku,qty,layak,rusak:qty-layak,diPesanan:di2,dariKomb:r.dariKomb||null,via:layak>0?lewatBS&&di2?"BIGSELLER":"RAKSA":null}}),harusBS=')
# keterangan bahwa box diuraikan
s = ganti(s,
  'return a.kode==="BELUM_ADA_DATA"&&!lewatBS&&add("info","Pesanan belum ada di data upload.',
  'return[...new Set(rows.filter(r=>r.dariKomb).map(r=>r.dariKomb))].forEach(kb=>{const kr=(c.kembali||[]).find(x=>x.sku===kb);add("info",`${kb} \\xD7${kr?+kr.qty:1} dihitung per komponen sesuai resep kombinasi (${rows.filter(r=>r.dariKomb===kb).reduce((t,r)=>t+r.qty,0)} pcs).`)}),a.kode==="BELUM_ADA_DATA"&&!lewatBS&&add("info","Pesanan belum ada di data upload.')
p.write_text(s); print("ok")
