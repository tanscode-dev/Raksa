#!/usr/bin/env python3
"""Mengubah bundle prototype Raksa (versi yang disetujui) menjadi Raksa 1.0 produksi.

Setiap penggantian diperiksa: teks yang dicari harus ditemukan tepat sebanyak yang
diharapkan. Kalau prototype berubah dan pola tidak cocok lagi, skrip berhenti
dengan pesan jelas, bukan diam-diam menghasilkan aplikasi rusak.

Pemakaian: python3 patch.py <prototype.js> <komponen.js> <keluaran.js>
"""
import re
import sys

src_path, komp_path, out_path = sys.argv[1:4]
s = open(src_path, encoding="utf-8").read()
komponen = open(komp_path, encoding="utf-8").read()


def ganti(lama, baru, n=1, ket=""):
    global s
    c = s.count(lama)
    if c != n:
        sys.exit(f"[patch] '{ket or lama[:60]}' ditemukan {c}x, diharapkan {n}x")
    s = s.replace(lama, baru)


def ganti_re(pola, baru, n=None, ket=""):
    global s
    hasil, c = re.subn(pola, baru, s)
    if n is not None and c != n:
        sys.exit(f"[patch] regex '{ket or pola[:60]}' cocok {c}x, diharapkan {n}x")
    if c == 0:
        sys.exit(f"[patch] regex '{ket or pola[:60]}' tidak cocok")
    s = hasil


# 1. ID unik per perangkat: "K-0012" -> "K-0012-ab3f" supaya dua orang yang
#    menambah kasus/pergerakan bersamaan tidak saling menimpa.
ganti_re(r'("[KMUE]-"\+String\([^()]*\)\.padStart\(\d,"0"\))', r'\1+__RID', ket="ID kasus/pergerakan")

# 2. Data awal dari server (bukan data contoh), peran dari akun yang login.
ganti('function cxe(){const[e,t]=w.useState(QN),',
      'function cxe(){const[e,t]=w.useState(RaksaDbAwal),', ket="state awal")
ganti('[n,a]=w.useState({peran:"OWNER",nama:"TIM"})',
      '[n,a]=w.useState(()=>({peran:window.__RAKSA.profil.akses,nama:window.__RAKSA.profil.nama}))', ket="peran login")

# 3. Simpan ke server (bukan memori browser).
lama_simpan = re.search(
    r'w\.useEffect\(\(\)=>\{\(async\(\)=>\{var Y,j;try\{const F=await\(\(j=\(Y=window\.storage\)==null\?void 0:Y\.get\)==null\?void 0:j\.call\(Y,"dg-db"\)\);F!=null&&F\.value&&r\(JSON\.parse\(F\.value\)\)\}catch\{\}\}\)\(\)\},\[\]\),w\.useEffect\(\(\)=>\{const Y=setTimeout\(\(\)=>\{var j,F;try\{\(F=\(j=window\.storage\)==null\?void 0:j\.set\)==null\|\|F\.call\(j,"dg-db",JSON\.stringify\(e\)\)\}catch\{\}\},800\);return\(\)=>clearTimeout\(Y\)\},\[e\]\)',
    s)
if not lama_simpan:
    sys.exit("[patch] blok simpan dg-db tidak ditemukan")
s = s.replace(lama_simpan.group(0),
              'w.useEffect(()=>{const Y=setTimeout(()=>{try{window.__RAKSA.simpan(e)}catch(z){console.error(z)}},400);return()=>clearTimeout(Y)},[e])')

# 4. Denda: karyawan memakai hasil hitung dari server; owner/admin menyimpan hasil hitung.
ganti('b=w.useMemo(()=>LX(e.cases,v,e.dendaMeta,e.settings),[e.cases,v,e.dendaMeta,e.settings])',
      'b=w.useMemo(()=>n.peran==="KARYAWAN"?(e.__dendaSaya||[]).map(K=>{const M=e.dendaMeta&&e.dendaMeta[K.id];return M?{...K,status:M.status||K.status,sanggahan:M.sanggahan||K.sanggahan}:K}):LX(e.cases,v,e.dendaMeta,e.settings),[e.cases,v,e.dendaMeta,e.settings,n.peran,e.__dendaSaya])',
      ket="denda")
ganti('const[rkSt,setRkSt]=w.useState(null);',
      'window.__RAKSA.pasang(t);w.useEffect(()=>{n.peran!=="KARYAWAN"&&window.__RAKSA.simpanDenda(b)},[b]);const[rkSt,setRkSt]=w.useState(null);',
      ket="pasang setter")

# 5. Robot 1 dari server GitHub: aplikasi bisa menerima file langsung (tanpa tab peluncur).
ganti('window.addEventListener("message",H);window.addEventListener("rk-hasil",Q);',
      'window.addEventListener("message",H);window.addEventListener("rk-hasil",Q);'
      'window.__rkProsesFile=(buf,name,token,reply)=>{const kb=Math.round((buf.byteLength||0)/1024);'
      'setRkSt({tahap:"PROSES",file:name||"pesanan.xlsx",kb,id:token||"",judul:"Robot 1 otomatis: impor pesanan"});'
      'window.__rkFile=new File([buf],name||"pesanan.xlsx");'
      'window.__rkReply=m=>{try{reply&&reply(m)}catch(e){}window.dispatchEvent(new CustomEvent("rk-hasil",{detail:m}))};'
      's("upload");setTimeout(()=>window.dispatchEvent(new Event("rk-file")),80)};',
      ket="proses file robot")

# 6. Kunci Robot 2 (tidak bisa dijalankan dua orang bersamaan).
ganti('const kirim=(it,nt,nk,judul)=>{',
      'const kirim=(it,nt,nk,judul)=>{if(window.__RAKSA){const kk=window.__RAKSA.kunciCache.robot2;'
      'if(kk&&kk.ok===!1){r("Robot 2 sedang dijalankan oleh "+(kk.oleh||"orang lain")+(kk.sampai?" (paling lama sampai "+new Date(kk.sampai).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})+")":"")+". Tunggu sampai selesai.","warn");return}'
      'window.__RAKSA.kunci("robot2").then(k=>{k&&k.ok===!1&&r("Perhatian: Robot 2 juga sedang dijalankan oleh "+(k.oleh||"orang lain")+".","bad")})}',
      ket="kunci robot 2")
ganti('window.__rkStokSelesai=(tk,hT,hK)=>{const it=(window.__rkStok||{})[tk];if(!it||it.selesai)return;it.selesai=!0;',
      'window.__rkStokSelesai=(tk,hT,hK)=>{const it=(window.__rkStok||{})[tk];if(!it||it.selesai)return;it.selesai=!0;window.__RAKSA&&window.__RAKSA.lepasKunci("robot2");',
      ket="lepas kunci")

# 7. Header: hapus pengganti peran demo, ganti dengan menu akun & keluar.
m = re.search(r'f\.jsx\("div",\{className:"px-2\.5 py-1\.5 text-\[10\.5px\] font-bold uppercase tracking-wider text-n-400",children:"Ganti peran \(demo hak akses\)"\}\),g\.map\(x=>f\.jsxs\("button",\{.*?\},x\.peran\+x\.nama\)\)', s)
if not m:
    sys.exit("[patch] menu ganti peran tidak ditemukan")
s = s.replace(m.group(0), 'f.jsx(RaksaMenuAkun,{tutup:()=>d(!1)})')
ganti('m=e.peran==="OWNER"?e.nama==="TIM"?"Owner":"Full akses"',
      'm=e.peran==="OWNER"?(s.karyawan.some(x=>x.nama===e.nama&&x.fullAkses)?"Full akses":"Owner")', ket="label peran")
ganti('onMouseLeave:()=>d(!1),children:[f.jsx(RaksaMenuAkun',
      'children:[f.jsx(RaksaMenuAkun', ket="menu akun tidak tertutup saat isi modal")

# 8. Pencarian global: kalau pesanan lama tidak ada di perangkat, cari di server.
ganti('l(`Pesanan / resi "${v}" tidak ditemukan di data upload`,"warn")',
      '(window.__RAKSA?window.__RAKSA.cariPesanan(v).then(K=>K?(n(K),u("")):l(`Pesanan / resi "${v}" tidak ditemukan`,"warn")):l(`Pesanan / resi "${v}" tidak ditemukan`,"warn"))',
      ket="cari pesanan")

# 9. Teks prototype.
ganti('children:"Prototype \\xB7 data disimpan di memori browser"})',
      'children:f.jsx(RaksaStatusSync,{})})', ket="label prototype sidebar")
ganti('f.jsx("div",{className:"mx-3 mt-3 rounded-lg bg-white/5 px-3 py-2 text-[11px] text-white/70",children:f.jsx(RaksaStatusSync,{})})',
      'f.jsx(RaksaStatusSync,{gelap:!0})', ket="status sync")
ganti('f.jsxs("div",{className:"mb-4 flex aspect-video max-w-full flex-col items-center justify-center gap-2 rounded-xl bg-black text-white/70",children:[f.jsx(QL,{size:28}),f.jsx("span",{className:"text-xs",children:"Kamera aktif di aplikasi final (@zxing/browser)"}),f.jsx("div",{className:"h-0.5 w-2/3 animate-pulse bg-brand-500"})]})',
      'f.jsx(RaksaKamera,{onKode:K=>{e(K),r(!1),a("")}})', ket="kamera")
ganti('label:"Prototype: ketik / tempel hasil scan"', 'label:"Atau ketik / tempel nomor pesanan atau resi"')
ganti('"Data stok di Raksa sudah data asli (bukan data contoh prototype), dan saya paham Robot 2 akan mengubah stok di BigSeller."',
      '"Saya sudah memeriksa daftar stok Siap impor dan paham Robot 2 akan mengubah stok di BigSeller."')
ganti('"Di prototype: klik Izinkan pada konfirmasi unduhan"', '"Unduh file dari Raksa"', n=2)
ganti('f.jsx("p",{children:"Di prototype ini, setiap unduhan meminta konfirmasi claude.ai, jadi Anda perlu klik Izinkan saat robot berjalan. Data prototype juga kembali ke contoh saat halaman dimuat ulang. Di aplikasi versi produksi keduanya tidak terjadi."})',
      'null', ket="catatan prototype otomatisasi")
m = re.search(r',f\.jsxs\(ze,\{title:"Data demo",children:\[.*?children:"Muat ulang data contoh"\}\)\]\}\)', s)
if not m:
    sys.exit("[patch] kartu Data demo tidak ditemukan")
s = s.replace(m.group(0), '')

# 10. Alamat Raksa produksi & folder download per laptop.
ganti('RK_URL="https://claude.ai/artifact/Svdq13aYMXcVWfCPNaywcV"', 'RK_URL=location.origin+"/"')
# Peluncur robot kini ada di domain Raksa sendiri (/peluncur), satu asal dengan aplikasi.
ganti('const RK_PELUNCUR="https://raksa-robot-tanscode1.vercel.app/"', 'const RK_PELUNCUR=location.origin+"/peluncur"')
ganti('ev.origin!=="https://raksa-robot-tanscode1.vercel.app"', 'ev.origin!==location.origin')
ganti('const rkFolderOf=D=>((D.settings&&D.settings.rkFolder)||RK_FOLDER)',
      'const rkFolderOf=D=>((()=>{try{return localStorage.getItem("raksa-rkFolder")}catch(e){return null}})()||(D.settings&&D.settings.rkFolder)||RK_FOLDER)',
      ket="folder per laptop")
ganti('rkAct.setSettings({rkFolder:v})',
      '((()=>{try{localStorage.setItem("raksa-rkFolder",v)}catch(e){}})(),rkAct.setSettings({rkFolder:v}))', ket="simpan folder")

# 11. Halaman Akun Login + Robot 1 otomatis di Upload Pesanan.
ganti('{id:"pengaturan",label:"Pengaturan",icon:SB,roles:["OWNER"]}]',
      '{id:"pengaturan",label:"Pengaturan",icon:SB,roles:["OWNER"]},{id:"akun",label:"Akun Login",icon:aB,roles:["OWNER"]}]',
      ket="menu akun")
ganti('case"pengaturan":return f.jsx(sxe,{});', 'case"pengaturan":return f.jsx(sxe,{});case"akun":return f.jsx(RaksaAkun,{});')
ganti('f.jsx("div",{className:"mb-4",children:f.jsx(RkRun1,{})})',
      'f.jsxs("div",{className:"mb-4 space-y-4",children:[f.jsx(RaksaRobot1Cloud,{},"rc"),f.jsx(RkRun1,{},"rm")]})', ket="robot 1 cloud")
ganti('title:"Robot 1: ambil pesanan dari BigSeller"', 'title:"Robot 1 manual (UI.Vision di laptop ini)"')

# 12. Sisipkan komponen tambahan tepat sebelum komponen aplikasi utama.
ganti('function cxe(){', komponen + '\nconst __RID="-"+Math.random().toString(36).slice(2,6);\nfunction cxe(){')

open(out_path, "w", encoding="utf-8").write(s)
print(f"[patch] selesai: {out_path} ({len(s)/1e6:.2f} MB)")
