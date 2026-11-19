"""Raksa · Harga modal SKU tidak lagi rusak oleh impor pesanan:
1. Kolom "Modal SKU Gudang" di file pesanan BigSeller ditulis dengan titik desimal ("1450.00")
   dan berisi total untuk jumlah yang dialokasikan. Dulu titiknya dibuang (jadi 100x) dan
   nilainya menimpa modal master setiap impor. Sekarang dibaca benar (rkAngkaDes) dan
   impor pesanan TIDAK lagi mengubah modal SKU yang sudah ada (modal diatur dari Master SKU /
   Katalog). SKU baru dari pesanan diberi modal per pcs (total / jumlah dialokasikan).
2. Impor Master SKU: "6389.00" dibaca 6.389 (dulu 638.900). Format Indonesia "6.389" tetap 6.389.
Denda tidak tersentuh (denda selalu memakai harga jual)."""
import pathlib
D = pathlib.Path(__file__).resolve().parent.parent / "dist"
def ganti(s, a, b, n=1):
    assert s.count(a) == n, (a[:90], s.count(a)); return s.replace(a, b)
p = D / "app.js"; s = p.read_text()
if "function rkAngkaDes(" in s:
    print("sudah"); raise SystemExit
FN = r'''function rkAngkaDes(v){if(typeof v=="number")return v;const s=String(v??"").trim().replace(/^Rp\.?\s*/i,"");if(/^-?\d+\.\d{1,2}$/.test(s)||/^-?\d+\.\d{4,}$/.test(s))return parseFloat(s);if(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s))return parseFloat(s.replace(/,/g,""));return Oo(v)}'''
s = ganti(s, "function NX(e8,t=Hf){", FN + "function NX(e8,t=Hf){")
s = ganti(s, 'modal:Oo(d(p,"modal"))', 'modal:rkAngkaDes(d(p,"modal"))')
s = ganti(s,
  'ge?(me.modal&&me.modal!==ge.modal||me.rak&&me.rak!==ge.rak)&&(Q[me.skuGudang]={...ge,modal:me.modal||ge.modal,rak:me.rak&&me.rak!=="Default Shelf"?me.rak:ge.rak}):(Q[me.skuGudang]={sku:me.skuGudang,nama:me.nama||me.skuGudang,modal:me.modal,jual:me.harga,rak:me.rak,aktif:!0},q++)',
  'ge?(me.rak&&me.rak!=="Default Shelf"&&me.rak!==ge.rak)&&(Q[me.skuGudang]={...ge,rak:me.rak}):(Q[me.skuGudang]={sku:me.skuGudang,nama:me.nama||me.skuGudang,modal:me.modal?Math.round(me.modal/(me.alokasi||me.jumlah||1)):0,jual:me.harga,rak:me.rak,aktif:!0},q++)')
s = ganti(s, 'J.modal&&(D.modal=+String(J.modal).replace(/[^0-9]/g,""))', 'J.modal&&(D.modal=Math.round(rkAngkaDes(J.modal)))')
p.write_text(s); print("ok")
