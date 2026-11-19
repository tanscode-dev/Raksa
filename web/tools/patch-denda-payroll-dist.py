"""Raksa · Status denda mengikuti keputusan Payroll (19 Nov 2026):
- Status baru DITUNDA (ditunda ke payroll berikutnya) & DIANULIR (dispensasi penuh/sebagian, dengan alasan).
- Tombol manual "Tandai aktif → sudah dipotong gaji" dihapus: status Sudah dipotong / Dianulir / Ditunda
  hanya diatur oleh Payroll saat payroll dikunci (payroll_tandai_denda_raksa).
- Koreksi di Raksa (batal/ubah jumlah/pindah orang) tetap final seperti sebelumnya."""
import pathlib
D = pathlib.Path(__file__).resolve().parent.parent / "dist"
def ganti(s, a, b, n=1):
    assert s.count(a) == n, (a[:90], s.count(a)); return s.replace(a, b)
p = D / "app.js"; s = p.read_text()
if "DIANULIR:" in s:
    print("sudah"); raise SystemExit
s = ganti(s, 'const H5={AKTIF:"wait",DISANGGAH:"warn",DIBATALKAN:"muted",SUDAH_DIPOTONG:"ok"};',
             'const H5={AKTIF:"wait",DISANGGAH:"warn",DIBATALKAN:"muted",SUDAH_DIPOTONG:"ok",DITUNDA:"warn",DIANULIR:"muted"};')
s = ganti(s, 'rxe={AKTIF:"Aktif",DISANGGAH:"Sedang disanggah",DIBATALKAN:"Dibatalkan",SUDAH_DIPOTONG:"Sudah dipotong gaji"};',
             'rxe={AKTIF:"Aktif",DISANGGAH:"Sedang disanggah",DIBATALKAN:"Dibatalkan",SUDAH_DIPOTONG:"Sudah dipotong gaji",DITUNDA:"Ditunda ke gaji berikutnya",DIANULIR:"Dianulir (dispensasi)"};')
# data dari dendaMeta ikut ke denda: nilai & alasan anulir, asal tunda; denda anulir/tunda tetap dihitung ke batas maksimal
s = ganti(s, 'h.periodeGaji=p.periodeGaji||null,h.nilaiDikenakan=h.nilai,i&&["AKTIF","SUDAH_DIPOTONG"].includes(h.status)',
             'h.periodeGaji=p.periodeGaji||null,h.nilaiAnulir=p.nilaiAnulir||0,h.alasanAnulir=p.alasanAnulir||null,h.ditundaDari=p.ditundaDari||null,h.nilaiDikenakan=h.nilai,i&&["AKTIF","SUDAH_DIPOTONG","DITUNDA","DIANULIR"].includes(h.status)')
s = ganti(s, 'footer:f.jsx(be,{icon:wB,variant:"secondary",onClick:()=>{m.filter(y=>y.orang===d&&y.status==="AKTIF").forEach(y=>t.dendaMeta(y.id,{status:"SUDAH_DIPOTONG",periodeGaji:i},`Denda ${y.id} dipotong gaji ${i}`)),r(`Denda ${d} ditandai sudah dipotong`)},children:"Tandai aktif \\u2192 sudah dipotong gaji"}),',
             'footer:f.jsx("p",{className:"text-[12px] text-n-600",children:"Status Sudah dipotong / Dianulir / Ditunda diatur otomatis dari Payroll saat payroll dikunci."}),')
s = ganti(s, 'children:y.status.replace("_"," ")}),y.koreksi&&f.jsx("span",{className:"max-w-[180px] text-[10.5px] text-indigo-700",children:y.koreksi})',
             'children:y.status.replace("_"," ")}),y.koreksi&&f.jsx("span",{className:"max-w-[180px] text-[10.5px] text-indigo-700",children:y.koreksi}),y.status==="DIANULIR"&&f.jsx("span",{className:"max-w-[180px] text-[10.5px] text-n-600",children:`Dianulir ${Ge(y.nilaiAnulir||0)}${y.periodeGaji?" \\xB7 gaji "+y.periodeGaji:""}${y.alasanAnulir?" \\xB7 "+y.alasanAnulir:""}`}),y.status==="DITUNDA"&&f.jsx("span",{className:"max-w-[180px] text-[10.5px] text-n-600",children:`Ditunda dari gaji ${y.ditundaDari||"-"}`})')
p.write_text(s); print("ok")
