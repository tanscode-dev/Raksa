# Impor master SKU: baris "GUDANG-xxx" dikenali sebagai SKU Gudang Besar milik "xxx",
# bukan SKU biasa. Induk ditautkan bila belum punya SKU Gudang.
import sys
p = sys.argv[1] if len(sys.argv) > 1 else "web/dist/app.js"
s = open(p, encoding="utf-8").read()
if "rkImporGudang" in s:
    print("sudah"); sys.exit(0)
old = 'for(const J of Y){const ne=F[J.sku],D={},PIC=J.pic?rkCocokNama(J.pic,j.karyawan):"";'
assert s.count(old) == 1, s.count(old)
new = ('for(const J of Y){if(/^GUDANG-./i.test(J.sku||"")){/*rkImporGudang*/const gk=String(J.sku).toUpperCase(),ik=gk.slice(7),ad=F[gk],ind=F[ik];'
       'F[gk]={...(ad||{}),sku:gk,nama:ik+" (stok Gudang Besar)",jual:0,aktif:ad?ad.aktif!==!1:!0,rak:"GUDANG BESAR",tipe:"GUDANG_BESAR",untuk:ik,'
       'modal:J.modal?Math.round(rkAngkaDes(J.modal)):(ad?.modal||ind?.modal||0)};'
       'ind&&!ind.gudangBesar&&(F[ik]={...ind,gudangBesar:gk});ad?te++:ee++;continue}'
       'const ne=F[J.sku],D={},PIC=J.pic?rkCocokNama(J.pic,j.karyawan):"";')
s = s.replace(old, new)
open(p, "w", encoding="utf-8").write(s)
print("ok")
