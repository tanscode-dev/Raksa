# Peringatan "barang pending tidak sesuai label":
# - tiap baris diberi kolom "Yang perlu dilakukan" (tahan stok / nama penghitung kosong / sudah beres)
# - klik SKU / "Buka" langsung membuka tanggal pending itu, scroll ke barangnya & disorot
# - owner bisa "Tandai beres" (item.selisihDicek) -> hilang dari peringatan; denda & stok tidak berubah
import sys
p = sys.argv[1] if len(sys.argv) > 1 else "web/dist/app.js"
s = open(p, encoding="utf-8").read()
if "rkSelisihCek" in s:
    print("sudah"); sys.exit(0)
def R(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, (c, a[:80])
    s = s.replace(a, b)

# 1. aksi baru: tandai beres (hanya ubah field item, tanpa sentuh movement)
R('pendingItem:(Y,j,F)=>r(L=>{',
  'rkSelisihCek:(Y,j,v)=>r(L=>A({...L,cases:L.cases.map(ue=>ue.id===Y?{...ue,items:ue.items.map(me=>me.id===j?{...me,selisihDicek:v}:me)}:ue)},`Selisih pending ${Y}: ${v?"ditandai beres":"dibuka lagi"}`)),'
  'pendingItem:(Y,j,F)=>r(L=>{')

# 2. data peringatan: abaikan yang sudah ditandai beres, hitung tindakan per baris
R('const rkSelisihDaftar=t.filter(k=>k.jenis==="PENDING").flatMap(k=>(k.items||[]).filter(y=>y.status==="SELISIH").map(y=>({k,y}))),h=rkSelisihDaftar;h.length&&l.push({untuk:"OWNER",level:"bad",judul:`${h.length} barang pending jumlahnya tidak sesuai label`,apa:"Hitungan rak beda dengan label pack. Sudah tercatat atas nama penghitung di label.",',
  'const rkSelisihDaftar=t.filter(k=>k.jenis==="PENDING").flatMap(k=>(k.items||[]).filter(y=>y.status==="SELISIH"&&!y.selisihDicek).map(y=>({k,y,tdk:rkTindakanSelisih(k,y,r,n)}))),h=rkSelisihDaftar,rkPerlu=h.filter(z=>z.tdk.perlu).length;h.length&&l.push({untuk:"OWNER",level:rkPerlu?"bad":"warn",judul:`${h.length} barang pending jumlahnya tidak sesuai label`,apa:rkPerlu?`${rkPerlu} perlu tindakan Anda (tanda merah). Sisanya sudah beres — cukup dicek lalu klik “Tandai beres”.`:"Semua sudah beres (stok & denda sudah diproses). Cek sebentar lalu klik “Tandai beres” supaya hilang dari daftar ini.",')
R('daftar:h.map(({k,y})=>{const lb=',
  'daftar:h.map(({k,y,tdk})=>{const lb=')
R('return{key:k.id+":"+y.id,nomor:y.sku,page:"pending",label:lb,',
  'return{key:k.id+":"+y.id,nomor:y.sku,page:"pending",tdk,caseId:k.id,itemId:y.id,fokus:{tgl:zN(k.tanggal),caseId:k.id,itemId:y.id,sku:y.sku,saran:tdk.teks},label:lb,')

# helper global (sebelum KX)
R('function KX({orders:e8,cases:t,movements:r,denda:n,',
  '''function rkTindakanSelisih(k,y,mv,dd){const lb=+(y.labelQty??y.qtyDiberikan)||0,sl=y.qtyDiterima==null?0:+y.qtyDiterima-lb,rp=v=>"Rp\\u00a0"+Math.round(+v||0).toLocaleString("id-ID"),nm=String(y.penghitungAwal||"").trim(),tanpaNama=!nm||/^(-|GA ADA NAMA|TANPA NAMA)$/i.test(nm),tahan=(mv||[]).some(m=>m.caseId===k.id&&String(m.itemId||"").startsWith(y.id)&&m.status==="MENUNGGU_APPROVAL"),d=(dd||[]).find(x=>x.id===`D-${k.id}-${y.id}`||String(x.id||"").startsWith(`D-${k.id}-${y.id}`));if(tahan)return{perlu:!0,judul:"Setujui / tolak perubahan stok",teks:"Selisihnya besar, jadi perubahan stok ditahan dan belum masuk BigSeller. Buka barangnya, cek fisik, lalu klik \\u201cSetujui perubahan stok\\u201d atau tolak."};if(tanpaNama&&sl<0)return{perlu:!0,judul:"Isi nama penghitung label",teks:`Kurang ${-sl} pcs tapi nama penghitung label kosong, jadi dendanya tidak masuk ke siapa pun. Buka barangnya, klik \\u201cUbah\\u201d, lalu isi nama penghitung label.`};const st=d?String(d.status||"AKTIF"):"",ds=!d?"":st==="DIBATALKAN"?"denda dibatalkan":st==="SUDAH_DIPOTONG"?`denda ${rp(d.nilai)} sudah dipotong gaji`:st==="DIANULIR"?"denda dianulir":st==="DITUNDA"?`denda ${rp(d.nilai)} ditunda`:+d.nilai>0?`denda ${rp(d.nilai)} masuk gaji berikutnya`:"tanpa denda";return{perlu:!1,judul:"Sudah beres",teks:(sl>0?`Lebih ${sl} pcs \\u2014 stok rak ikut hitungan, `:`Stok sudah ikut hitungan rak, `)+(ds||"tanpa denda")+"."}}function KX({orders:e8,cases:t,movements:r,denda:n,''')

# 3. tabel: ganti kolom Kasus -> Yang perlu dilakukan, klik SKU deep-link
R('th("Penghitung label"),th("Tanggal"),th("Kasus")]',
  'th("Penghitung label"),th("Tanggal"),th("Yang perlu dilakukan")]')
R('minWidth:"660px"}', 'minWidth:"860px"}')
R('f.jsx("button",{onClick:()=>a(c.page),className:"font-mono font-semibold text-brand-700"',
  'f.jsx("button",{onClick:()=>{window.__rkFokus={...c.fokus,t:Date.now()};a(c.page)},className:"font-mono font-semibold text-brand-700"')
R('f.jsx("td",{className:"font-mono text-n-500 whitespace-nowrap",style:td(0,{fontSize:"11.5px"}),children:c.kasus})]},c.key)',
  '''f.jsxs("td",{style:td(0,{minWidth:"240px"}),children:[f.jsxs("div",{style:{display:"flex",alignItems:"center",gap:"6px",fontWeight:700,color:c.tdk&&c.tdk.perlu?"#e11d48":"#059669"},children:[f.jsx("span",{style:{width:"8px",height:"8px",borderRadius:"999px",background:"currentColor",flex:"none"}}),c.tdk?c.tdk.judul:"-"]}),f.jsx("div",{className:"text-n-600",style:{fontSize:"11.5px",lineHeight:1.35,marginTop:"2px"},children:c.tdk&&c.tdk.teks}),f.jsxs("div",{style:{display:"flex",gap:"6px",marginTop:"6px",flexWrap:"wrap"},children:[f.jsx("button",{onClick:()=>{window.__rkFokus={...c.fokus,t:Date.now()};a(c.page)},style:{fontSize:"11.5px",fontWeight:600,padding:"3px 10px",borderRadius:"8px",border:"1px solid currentColor",background:"none",cursor:"pointer"},className:"text-brand-700",children:"Buka barang \\u203a"}),c.tdk&&!c.tdk.perlu&&f.jsx(RkTandaiBeres,{c})]})]})]},c.key)''')
R('children:"Klik SKU untuk membuka di halaman Pending"', 'children:"Klik SKU atau \\u201cBuka barang\\u201d untuk langsung ke barangnya di halaman Pending"')

# tombol Tandai beres (pakai act dari context)
R('function KX({orders:e8,',
  'function RkTandaiBeres({c}){const{act,toast,role}=gt();return f.jsx("button",{onClick:()=>{act.rkSelisihCek(c.caseId,c.itemId,{oleh:role&&role.nama,waktu:new Date().toISOString()});toast&&toast(`${c.nomor} ditandai beres`)},style:{fontSize:"11.5px",fontWeight:600,padding:"3px 10px",borderRadius:"8px",border:0,background:"#059669",color:"#fff",cursor:"pointer"},children:"\\u2713 Tandai beres"})}function KX({orders:e8,')

# 4. halaman Pending: buka tanggal barang yang diklik, scroll & sorot
R('o=n.peran==="KARYAWAN"&&!l,[u,c]=w.useState(Gd()),[d,h]=w.useState(""),',
  'o=n.peran==="KARYAWAN"&&!l,[rkFk]=w.useState(()=>{const F=window.__rkFokus;return F&&Date.now()-F.t<6e4?F:null}),[u,c]=w.useState(()=>rkFk&&rkFk.tgl||Gd()),[d,h]=w.useState(""),')
R('return f.jsxs("div",{children:[f.jsx(Pa,{title:o?"Pending saya":"Pending",',
  'w.useEffect(()=>{if(!rkFk)return;window.__rkFokus=null;const t0=setTimeout(()=>{const el=document.getElementById("rkp-"+rkFk.caseId+"-"+rkFk.itemId);if(!el)return;el.scrollIntoView({behavior:"smooth",block:"center"});el.style.transition="box-shadow .3s, background .3s";el.style.boxShadow="inset 0 0 0 2px #10b981";el.style.background="rgba(16,185,129,.08)";setTimeout(()=>{el.style.boxShadow="";el.style.background=""},6e3)},350);return()=>clearTimeout(t0)},[]);'
  'return f.jsxs("div",{children:[rkFk&&f.jsxs("div",{style:{marginBottom:"12px",padding:"10px 14px",borderRadius:"12px",border:"1px solid rgba(16,185,129,.45)",background:"rgba(16,185,129,.08)",fontSize:"13px"},children:[f.jsxs("div",{style:{fontWeight:700},children:["Membuka ",rkFk.sku," \\u00b7 ",Dt(rkFk.tgl+"T12:00")]}),rkFk.saran&&f.jsx("div",{className:"text-n-700",style:{marginTop:"2px"},children:rkFk.saran})]}),f.jsx(Pa,{title:o?"Pending saya":"Pending",')
R('return f.jsxs("li",{className:"px-4 py-3",children:[f.jsxs("div",{className:"flex flex-wrap items-start gap-x-4 gap-y-2"',
  'return f.jsxs("li",{id:"rkp-"+e8.id+"-"+t.id,className:"px-4 py-3",children:[f.jsxs("div",{className:"flex flex-wrap items-start gap-x-4 gap-y-2"')
open(p, "w", encoding="utf-8").write(s)
print("ok")
