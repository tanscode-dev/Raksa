#!/usr/bin/env python3
"""Nama di Raksa dikunci ke daftar karyawan (16 Nov 2026).
- Isian nama penghitung (Pending) & "Yang menghitung di rak" jadi pilihan dari Master Data → Karyawan (tidak bisa diketik bebas).
- Tambah/Edit karyawan Raksa: nama dipilih dari Karyawan Business Manager (PayrollKu), lewat RPC raksa_karyawan_bm.
- Upload master SKU: kolom PIC dicocokkan ke daftar karyawan (AGUNG → AGUNG HOLID JAELANI); nama yang tidak dikenal diabaikan.
- Warna titik pindah aplikasi mengikuti logo baru.
Pemakaian: python3 tools/patch-nama-karyawan-dist.py dist/app.js
"""
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "function RkNamaBM(" in s:
    sys.exit("[nama-karyawan] sudah dipasang")

def ganti(lama, baru, n=1):
    global s
    c = s.count(lama)
    if c != n:
        sys.exit(f"[nama-karyawan] pola ditemukan {c}x, diharapkan {n}x: {lama[:80]}")
    s = s.replace(lama, baru)

PILIH_A = 'f.jsx($e,{value:x,onChange:O=>v(O.target.value),options:[{value:"",label:"Pilih nama\\u2026"},...rkOpsiNama(a.karyawan,x)]})'
ganti('f.jsx(Fe,{value:x,onChange:O=>v(O.target.value),list:"dl-kar",placeholder:"mis. DIMAS"})', PILIH_A)
ganti('f.jsx(Fe,{value:x,onChange:O=>v(O.target.value),list:"dl-kar"})', PILIH_A)
ganti('__h(Fe,{value:value||"",onChange:e8=>onChange(e8.target.value),list:"dl-kar",placeholder:"mis. AGUNG H","data-rk":"penghitung-rak"})',
      '__h($e,{value:value||"",onChange:e8=>onChange(e8.target.value),options:[{value:"",label:"Pilih nama\\u2026"},...rkOpsiNama(gt().db.karyawan,value)],"data-rk":"penghitung-rak"})')
ganti('f.jsx(de,{label:"Nama",children:f.jsx(Fe,{id:"k-nama",value:y.nama,onChange:_=>b({...y,nama:_.target.value})})})',
      'f.jsx(de,{label:"Nama",hint:"Dipilih dari Karyawan Business Manager (PayrollKu \\u2192 Karyawan).",children:f.jsx(RkNamaBM,{value:y.nama,onChange:_=>b({...y,nama:_.target.value}),dipakai:e8.karyawan.map(k=>k.nama).filter(k=>k!==y.lama)})})')
# upload master: PIC dicocokkan ke daftar karyawan
ganti('for(const J of Y){const ne=F[J.sku],D={};', 'for(const J of Y){const ne=F[J.sku],D={},PIC=J.pic?rkCocokNama(J.pic,j.karyawan):"";')
ganti('J.rak&&J.pic&&L[J.rak]!==J.pic.toUpperCase()&&(L[J.rak]=J.pic.toUpperCase(),', 'J.rak&&PIC&&L[J.rak]!==PIC&&(L[J.rak]=PIC,')
ganti('{rak:J.rak,pic:J.pic.toUpperCase(),dari:q,sampai:null}', '{rak:J.rak,pic:PIC,dari:q,sampai:null}')
# warna pindah aplikasi = warna logo
ganti('AKSA_HUB+"/seller","#34c08f"],["PayrollKu",RAKSA_HUB+"/app","#7c95ff"],["Raksa",null,"#f0b43c"],["Invoice Manager",RAKSA_HUB+"/invoice","#c084fc"]]',
      'AKSA_HUB+"/seller","#f59e0b"],["PayrollKu",RAKSA_HUB+"/app","#8b5cf6"],["Raksa",null,"#2fb88c"],["Invoice Manager",RAKSA_HUB+"/invoice","#4f7bff"]]')
helper = r'''function rkOpsiNama(daftar,kini){const n=(daftar||[]).filter(k=>k.aktif!==!1).map(k=>k.nama);return kini&&!n.includes(kini)?[...n,kini]:n}function rkCocokNama(isi,daftar){const nama=(daftar||[]).map(k=>k.nama);return String(isi||"").split(",").map(t=>t.trim().toUpperCase()).filter(Boolean).map(t=>{if(nama.includes(t))return t;const c=nama.filter(n=>n.startsWith(t+" ")||n.split(" ")[0]===t.split(" ")[0]);return c.length===1?c[0]:""}).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(", ")}function RkNamaBM({value,onChange,dipakai}){const[daftar,setDaftar]=w.useState(null);w.useEffect(()=>{const R=window.__RAKSA;if(!R||!R.sb){setDaftar([]);return}R.sb.rpc("raksa_karyawan_bm").then(({data})=>setDaftar(Array.isArray(data)?data.map(x=>String(x).toUpperCase()):[]),()=>setDaftar([]))},[]);const sisa=(daftar||[]).filter(n=>!(dipakai||[]).includes(n));const opsi=value&&!sisa.includes(value)?[value,...sisa]:sisa;return __h($e,{id:"k-nama",value:value||"",onChange,options:[{value:"",label:daftar===null?"Memuat karyawan…":"Pilih karyawan…"},...opsi]})}'''
ganti('function RkPenghitungRak({value,onChange}){', helper + 'function RkPenghitungRak({value,onChange}){')
open(p, "w", encoding="utf-8").write(s)
print("[nama-karyawan] selesai")
