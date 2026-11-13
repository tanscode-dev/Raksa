#!/usr/bin/env python3
"""Pending: picker/admin boleh memperbaiki salah ketik, dengan batas (13 Nov 2026).

- Jumlah yang diminta boleh diubah (atau baris dihapus) selama belum diambilkan dari gudang.
- Setelah barang dihitung (Selesai/Selisih), hasil hitungan boleh diubah 5 menit saja.
- Pending hari sebelumnya terkunci untuk semua selain Owner.
Server ikut menjaga aturan yang sama (trigger raksa_kunci_pending di database BM).

Dijalankan langsung pada dist/app.js (lihat catatan di patch-waktu-dist.py).
Pemakaian: python3 tools/patch-ubah-pending-dist.py dist/app.js
"""
import sys

p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "rkBolehHitung" in s:
    sys.exit("[ubah-pending] sudah dipasang")


def ganti(lama, baru, n=1):
    global s
    c = s.count(lama)
    if c != n:
        sys.exit(f"[ubah-pending] '{lama[:70]}' ditemukan {c}x, diharapkan {n}x")
    s = s.replace(lama, baru)


# 1. status kunci per baris + jam hitung mundur 5 menit
ganti('[rkCp,rkSetCp]=w.useState([]),[rkPr,rkSetPr]=w.useState(""),I=(O,K)=>{',
      '[rkCp,rkSetCp]=w.useState([]),[rkPr,rkSetPr]=w.useState(""),[rkQ,rkSetQ]=w.useState(""),'
      '[rkNow,rkSetNow]=w.useState(Date.now()),rkHari=zN(e8.tanggal)===Gd(),rkKunci=!i&&!rkHari,'
      'rkSisa=t.waktuTerima&&["SELESAI","SELISIH"].includes(t.status)?3e5-(rkNow-new Date(t.waktuTerima).getTime()):-1,'
      'rkBolehHitung=!i&&rkHari&&(o||u||c)&&rkSisa>0,'
      'I=(O,K)=>{')
ganti('return f.jsxs("li",{className:"px-4 py-3",children:[',
      'w.useEffect(()=>{if(!(rkSisa>0))return;const iv=setInterval(()=>rkSetNow(Date.now()),1e3);return()=>clearInterval(iv)},[t.waktuTerima,t.status,rkSisa>0]);'
      'return f.jsxs("li",{className:"px-4 py-3",children:[')

# 2. tombol proses disembunyikan untuk pending hari lalu (kecuali Owner)
ganti('t.status==="MENUNGGU"&&!h&&(o?', 't.status==="MENUNGGU"&&!h&&!rkKunci&&(o?')
ganti('t.status==="DIKIRIM"&&!h&&(o||u||c?', 't.status==="DIKIRIM"&&!h&&!rkKunci&&(o||u||c?')
ganti('t.status==="KOSONG"&&!h&&(o||u?', 't.status==="KOSONG"&&!h&&!rkKunci&&(o||u?')

# 3. tombol baru: Ubah jumlah, Ubah hitungan (5 menit), tanda terkunci
ganti('children:"Ubah"})]})]}),h==="kirim"&&',
      'children:"Ubah"}),'
      'rkKunci&&f.jsx("span",{className:"self-center text-[12px] font-semibold text-n-500","data-rk":"pending-terkunci",children:"\\u{1F512} Terkunci \\xB7 hari sudah lewat"}),'
      '!i&&rkHari&&t.status==="MENUNGGU"&&!h&&(o||u||c)&&f.jsx(be,{size:"sm",variant:"ghost",icon:Yc,"data-rk":"ubah-jumlah",onClick:()=>{rkSetQ(String(t.qty)),p("ubahJumlah")},children:"Ubah jumlah"}),'
      'rkBolehHitung&&!h&&f.jsx(be,{size:"sm",variant:"ghost",icon:Yc,"data-rk":"ubah-hitung",onClick:()=>{y(String(t.qtyDiterima??"")),S(t.qtyRusak?String(t.qtyRusak):""),v(t.penghitungAwal||""),rkSetCp(t.campur||[]),rkSetPr(t.penghitungRak||e8.pic||""),p("ubahHitung")},'
      'children:`Ubah hitungan (sisa ${Math.floor(Math.min(rkSisa,3e5)/6e4)}:${String(Math.floor(Math.min(rkSisa,3e5)%6e4/1e3)).padStart(2,"0")})`}),'
      '!i&&rkHari&&(o||u||c)&&["SELESAI","SELISIH"].includes(t.status)&&t.waktuTerima&&!(rkSisa>0)&&!h&&f.jsx("span",{className:"self-center text-[11.5px] text-n-500","data-rk":"hitung-terkunci",children:"\\u{1F512} Terkunci \\xB7 batas ubah 5 menit lewat"})'
      ']})]}),'
      '(t.riwayatUbah||[]).length>0&&f.jsx("div",{className:"mt-1 text-[12px] text-n-600","data-rk":"riwayat-ubah",children:"Jumlah diubah: "+t.riwayatUbah.map(q=>`${q.dari}\\u2192${q.ke} (${HN(q.waktu)}${q.oleh?" "+q.oleh:""})`).join(" \\xB7 ")}),'
      'h==="ubahJumlah"&&f.jsxs("form",{onSubmit:O=>{O.preventDefault();if(t.status!=="MENUNGGU"||rkKunci)return n("Sudah diambilkan dari gudang, jumlah tidak bisa diubah lagi","warn"),p(null);'
      'const K=Math.floor(+rkQ);if(!(K>0))return n("Isi jumlah minimal 1","warn");if(K===t.qty)return p(null);'
      'const ent=t.entries||[];I({qty:K,entries:[{waktu:(ent[0]&&ent[0].waktu)||t.waktu,qty:K}],riwayatUbah:[...(t.riwayatUbah||[]),{waktu:new Date().toISOString(),oleh:s.nama,dari:t.qty,ke:K}]},`${t.sku}: jumlah diubah ${t.qty} \\u2192 ${K} pcs`)},'
      'className:"mt-3 grid gap-3 rounded-lg bg-brand-50 p-3 sm:grid-cols-[1fr_auto]","data-rk":"form-ubah-jumlah",children:['
      'f.jsx(de,{label:"Jumlah dibutuhkan (pcs)",hint:"Bisa diubah selama belum diambilkan dari gudang.",children:f.jsx(Fe,{type:"number",min:"1",inputMode:"numeric",autoFocus:!0,value:rkQ,onChange:O=>rkSetQ(O.target.value)})}),'
      'f.jsxs("div",{className:"flex flex-wrap items-end gap-2",children:['
      'f.jsx(be,{type:"button",variant:"secondary",onClick:()=>p(null),children:"Batal"}),'
      'f.jsx(be,{type:"button",variant:"danger",icon:YL,onClick:()=>{if(t.status!=="MENUNGGU"||rkKunci)return n("Sudah diambilkan dari gudang","warn"),p(null);I({status:"BATAL",riwayatUbah:[...(t.riwayatUbah||[]),{waktu:new Date().toISOString(),oleh:s.nama,dari:t.qty,ke:0}]},`${t.sku} dihapus dari daftar pending`)},children:"Hapus dari daftar"}),'
      'f.jsx(be,{type:"submit",children:"Simpan"})]})]}),'
      'h==="kirim"&&')

# 4. form hitung dipakai juga untuk "Ubah hitungan"; waktu terima tidak bergeser
ganti('h==="hitung"&&f.jsxs("form",{onSubmit:O=>{if(O.preventDefault(),k==="")return;',
      '(h==="hitung"||h==="ubahHitung")&&f.jsxs("form",{onSubmit:O=>{if(O.preventDefault(),k==="")return;'
      'if(h==="ubahHitung"&&!i&&!(t.waktuTerima&&Date.now()-new Date(t.waktuTerima).getTime()<3e5))return n("Batas ubah 5 menit sudah lewat","warn"),p(null);')
ganti('waktuTerima:new Date().toISOString()},(z?',
      'waktuTerima:h==="ubahHitung"&&t.waktuTerima?t.waktuTerima:new Date().toISOString()},(z?')
ganti('f.jsx(de,{label:"Dari jumlah itu, yang rusak",children:f.jsx(Fe,{type:"number",min:"0",inputMode:"numeric",value:A,onChange:O=>S(O.target.value),placeholder:"0"})})',
      'f.jsx(de,{label:"Dari jumlah itu, yang rusak",hint:h==="ubahHitung"&&a.cases.some(q=>q.dariPending===t.id)?"Sudah dicatat di Barang Rusak; ubah di sana.":void 0,'
      'children:f.jsx(Fe,{type:"number",min:"0",inputMode:"numeric",value:A,onChange:O=>S(O.target.value),placeholder:"0",disabled:h==="ubahHitung"&&a.cases.some(q=>q.dariPending===t.id)})})')

open(p, "w", encoding="utf-8").write(s)
print("[ubah-pending] selesai")
