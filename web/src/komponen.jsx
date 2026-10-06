// Komponen tambahan Raksa 1.0 yang disisipkan ke dalam aplikasi Raksa.
// Memakai komponen UI yang sama dengan aplikasi (ze = kartu, be = tombol,
// de = label kolom, Fe = input, $e = pilihan, Le = lencana, Yn = jendela,
// Pa = judul halaman, gt = konteks aplikasi) supaya tampilannya seragam.
/* global f, w, ze, be, de, Fe, $e, Le, Yn, Pa, gt, Ce, Qx, Mk, Hf, zD */

const __h = (t, p, ...c) => {
  const props = { ...(p || {}) };
  const anak = c.flat ? c : c;
  if (anak.length === 1) props.children = anak[0];
  else if (anak.length > 1) props.children = anak;
  return anak.length > 1 ? f.jsxs(t, props) : f.jsx(t, props);
};
const __F = f.Fragment;

// ---------------------------------------------------------------- data kosong
function RaksaKosong() {
  return {
    orders: {}, history: [], uploads: [], kombinasi: {}, cases: [], movements: [],
    exportBatches: [], dendaMeta: {}, skus: {}, rakMap: {}, rakHist: [], karyawan: [],
    toko: [...Qx, "SHEROZKY - LAZADA", "Manual Orders"],
    settings: {
      aturan: { ...Mk }, dendaPacker: true, batasDenda: 0, eksporMode: "net",
      hargaMode: "kosong", kolom: { ...Hf }, statusExtra: {}, statusTakDikenal: [],
      adminLihatSemua: false, karyawanLihatDenda: true, menuBarangMasuk: false,
      dendaRusak: true, dendaSelisih: true, approval: { ...zD },
    },
    audit: [],
  };
}
function RaksaDbAwal() {
  const R = window.__RAKSA;
  const kosong = RaksaKosong();
  const muat = (R && R.db) || {};
  const db = { ...kosong, ...muat };
  db.settings = { ...kosong.settings, ...(muat.settings || {}) };
  db.settings.aturan = { ...kosong.settings.aturan, ...((muat.settings || {}).aturan || {}) };
  db.settings.approval = { ...kosong.settings.approval, ...((muat.settings || {}).approval || {}) };
  db.settings.kolom = { ...kosong.settings.kolom, ...((muat.settings || {}).kolom || {}) };
  if (!Array.isArray(db.toko) || !db.toko.length) db.toko = kosong.toko;
  db.__dendaSaya = (R && R.dendaSaya) || [];
  return db;
}

// ---------------------------------------------------------------- langganan status
function useRaksaStatus() {
  const R = window.__RAKSA;
  const [s, setS] = w.useState(R ? R.status : {});
  w.useEffect(() => R && R.dengar((x) => setS({ ...x })), []);
  return s;
}

function RaksaStatusSync({ gelap }) {
  const s = useRaksaStatus();
  const fase = s.fase || "tersimpan";
  const antre = s.antre || 0;
  const [teks, warna] =
    fase === "offline" ? [`Offline · ${antre} perubahan menunggu`, "#f59e0b"]
    : fase === "gagal" ? [`Gagal menyimpan · mencoba lagi`, "#f43f5e"]
    : fase === "menyimpan" || antre > 0 ? ["Menyimpan…", "#f59e0b"]
    : ["Tersimpan di server", "#34d399"];
  return __h("div", {
    className: gelap
      ? "mx-3 mt-3 rounded-lg bg-white/5 px-3 py-2 text-[11px] text-white/70"
      : "text-[11px] text-n-500",
    title: s.pesan || "",
  },
    __h("span", { style: { display: "inline-block", width: 7, height: 7, borderRadius: 9, background: warna, marginRight: 6 } }),
    teks,
    gelap && __h("div", { className: "mt-1 text-white/60" }, "Raksa 1.0"));
}

// ---------------------------------------------------------------- menu akun (header)
function RaksaMenuAkun({ tutup }) {
  const R = window.__RAKSA;
  const p = (R && R.profil) || {};
  const [ganti, setGanti] = w.useState(false);
  const label = p.akses === "OWNER" ? "Owner" : p.akses === "ADMIN" ? "Admin" : "Karyawan";
  const ref = w.useRef(null);
  w.useEffect(() => {
    const klik = (e) => { if (ref.current && !ref.current.contains(e.target)) tutup && tutup(); };
    const t = setTimeout(() => document.addEventListener("click", klik), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", klik); };
  }, []);
  return __h("div", { ref },
    __h("div", { className: "px-2.5 py-2" },
      __h("div", { className: "text-sm font-bold text-n-900" }, p.nama),
      __h("div", { className: "text-xs text-n-500" }, `@${p.username} · ${label}`)),
    __h("div", { className: "my-1 border-t border-n-100" }),
    __h("button", {
      className: "flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-n-800 hover:bg-n-50",
      onClick: () => setGanti(true),
    }, "Ganti kata sandi"),
    __h("button", {
      className: "flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-rose-700 hover:bg-n-50",
      onClick: () => R && R.keluar(),
    }, "Keluar"),
    ganti && __h(RaksaGantiSandi, { tutup: () => { setGanti(false); tutup && tutup(); } }));
}

function RaksaGantiSandi({ tutup }) {
  const { toast } = gt();
  const [a, setA] = w.useState("");
  const [b, setB] = w.useState("");
  const [sibuk, setSibuk] = w.useState(false);
  const simpan = async () => {
    if (a.length < 6) return toast("Kata sandi minimal 6 karakter", "warn");
    if (a !== b) return toast("Kedua kata sandi tidak sama", "warn");
    setSibuk(true);
    const err = await window.__RAKSA.gantiSandi(a);
    setSibuk(false);
    if (err) return toast(err, "bad");
    toast("Kata sandi diganti");
    tutup();
  };
  return __h(Yn, {
    open: true, onClose: tutup, title: "Ganti kata sandi",
    footer: __h(__F, null,
      __h(be, { variant: "secondary", onClick: tutup }, "Batal"),
      __h(be, { onClick: simpan, disabled: sibuk }, sibuk ? "Menyimpan…" : "Simpan")),
  },
    __h("div", { className: "space-y-3" },
      __h(de, { label: "Kata sandi baru" }, __h(Fe, { type: "password", value: a, onChange: (e) => setA(e.target.value), autoFocus: true })),
      __h(de, { label: "Ulangi kata sandi baru" }, __h(Fe, { type: "password", value: b, onChange: (e) => setB(e.target.value) }))));
}

// ---------------------------------------------------------------- halaman Akun Login
function RaksaAkun() {
  const { db, toast } = gt();
  const R = window.__RAKSA;
  const [akun, setAkun] = w.useState(null);
  const [form, setForm] = w.useState(null);
  const [sandiUntuk, setSandiUntuk] = w.useState(null);
  const [sandiBaru, setSandiBaru] = w.useState("");
  const [sibuk, setSibuk] = w.useState(false);

  const muat = async () => {
    const r = await R.akun({ aksi: "daftar" });
    if (r.pesan) toast(r.pesan, "bad");
    setAkun(r.akun || []);
  };
  w.useEffect(() => { muat(); }, []);

  const namaKaryawan = (db.karyawan || []).filter((k) => k.aktif !== false).map((k) => k.nama);
  const sudahPunya = new Set((akun || []).map((a) => a.nama));
  const saranAkses = (nama) => {
    const k = (db.karyawan || []).find((x) => x.nama === nama);
    if (!k) return "KARYAWAN";
    if (k.fullAkses) return "OWNER";
    const perans = k.perans && k.perans.length ? k.perans : k.peran ? [k.peran] : [];
    return perans.includes("Admin") ? "ADMIN" : "KARYAWAN";
  };

  const buat = async () => {
    const f2 = form;
    if (!f2.nama) return toast("Pilih nama karyawan", "warn");
    setSibuk(true);
    const r = await R.akun({ aksi: "buat", ...f2 });
    setSibuk(false);
    if (!r.ok) return toast(r.pesan || "Gagal membuat akun", "bad");
    toast(`Akun @${r.username} dibuat`);
    setForm(null);
    muat();
  };
  const ubah = async (a, isi, pesan) => {
    const r = await R.akun({ aksi: "ubah", user_id: a.user_id, ...isi });
    if (!r.ok) return toast(r.pesan || "Gagal", "bad");
    toast(pesan);
    muat();
  };
  const gantiSandi = async () => {
    if (sandiBaru.length < 6) return toast("Kata sandi minimal 6 karakter", "warn");
    const r = await R.akun({ aksi: "sandi", user_id: sandiUntuk.user_id, sandi: sandiBaru });
    if (!r.ok) return toast(r.pesan || "Gagal", "bad");
    toast(`Kata sandi @${sandiUntuk.username} diganti`);
    setSandiUntuk(null);
    setSandiBaru("");
  };

  const labelAkses = { OWNER: "Owner / Full akses", ADMIN: "Admin", KARYAWAN: "Karyawan" };
  const tone = { OWNER: "gold", ADMIN: "info", KARYAWAN: "muted" };

  return __h("div", null,
    __h(Pa, {
      title: "Akun Login",
      desc: "Setiap orang masuk ke Raksa dengan nama pengguna dan kata sandinya sendiri. Nama akun harus sama dengan nama di Master Data → Karyawan, supaya denda dan tugasnya tepat.",
      actions: __h(be, { onClick: () => setForm({ username: "", sandi: "", nama: "", akses: "KARYAWAN" }) }, "Tambah akun"),
    }),
    __h(ze, { title: "Daftar akun", pad: false },
      akun === null
        ? __h("p", { className: "p-4 text-sm text-n-500" }, "Memuat…")
        : __h("div", { className: "overflow-x-auto" },
          __h("table", { className: "w-full min-w-[640px] text-sm" },
            __h("thead", null,
              __h("tr", { className: "border-b border-n-100 text-left text-[12px] text-n-500" },
                __h("th", { className: "px-4 py-2" }, "Nama"),
                __h("th", { className: "px-4 py-2" }, "Nama pengguna"),
                __h("th", { className: "px-4 py-2" }, "Akses"),
                __h("th", { className: "px-4 py-2" }, "Status"),
                __h("th", { className: "px-4 py-2 text-right" }, "Aksi"))),
            __h("tbody", null,
              ...akun.map((a) => __h("tr", { key: a.user_id, className: "border-b border-n-100" },
                __h("td", { className: "px-4 py-2 font-semibold text-n-900" }, a.nama,
                  !namaKaryawan.includes(a.nama) && a.akses !== "OWNER" &&
                    __h("div", { className: "text-[11px] font-normal text-amber-700" }, "Belum ada di Master Karyawan")),
                __h("td", { className: "px-4 py-2 font-mono text-[12.5px]" }, "@" + a.username),
                __h("td", { className: "px-4 py-2" },
                  __h($e, {
                    className: "!w-40", value: a.akses,
                    onChange: (e) => ubah(a, { akses: e.target.value }, `Akses ${a.nama} diubah`),
                    options: Object.entries(labelAkses).map(([value, label]) => ({ value, label })),
                  })),
                __h("td", { className: "px-4 py-2" },
                  __h(Le, { tone: a.aktif ? "ok" : "muted" }, a.aktif ? "Aktif" : "Nonaktif")),
                __h("td", { className: "px-4 py-2 text-right" },
                  __h("div", { className: "flex justify-end gap-2" },
                    __h(be, { size: "sm", variant: "secondary", onClick: () => { setSandiUntuk(a); setSandiBaru(""); } }, "Ganti sandi"),
                    __h(be, {
                      size: "sm", variant: a.aktif ? "ghost" : "soft",
                      onClick: () => ubah(a, { aktif: !a.aktif }, a.aktif ? `${a.nama} dinonaktifkan` : `${a.nama} diaktifkan`),
                    }, a.aktif ? "Nonaktifkan" : "Aktifkan"))))))))),
    __h("p", { className: "mt-3 text-xs text-n-500" },
      "Akses Owner / Full akses melihat dan mengerjakan semua. Admin menginput kasus dan upload. Karyawan hanya melihat Pending dan dendanya sendiri."),

    form && __h(Yn, {
      open: true, onClose: () => setForm(null), title: "Tambah akun",
      footer: __h(__F, null,
        __h(be, { variant: "secondary", onClick: () => setForm(null) }, "Batal"),
        __h(be, { onClick: buat, disabled: sibuk }, sibuk ? "Membuat…" : "Buat akun")),
    },
      __h("div", { className: "space-y-3" },
        __h(de, { label: "Nama karyawan", hint: "Diambil dari Master Data → Karyawan" },
          __h($e, {
            value: form.nama,
            onChange: (e) => setForm({ ...form, nama: e.target.value, akses: saranAkses(e.target.value),
              username: form.username || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 24) }),
            options: [{ value: "", label: "Pilih nama…" },
              ...namaKaryawan.filter((n) => !sudahPunya.has(n)).map((n) => ({ value: n, label: n }))],
          })),
        __h(de, { label: "Nama pengguna", hint: "Huruf kecil, angka, titik. Dipakai saat masuk." },
          __h(Fe, { value: form.username, onChange: (e) => setForm({ ...form, username: e.target.value.toLowerCase().trim() }), placeholder: "mis. agung" })),
        __h(de, { label: "Kata sandi awal", hint: "Minimal 6 karakter. Berikan langsung ke orangnya, lalu minta ia menggantinya." },
          __h(Fe, { type: "text", value: form.sandi, onChange: (e) => setForm({ ...form, sandi: e.target.value }) })),
        __h(de, { label: "Akses" },
          __h($e, {
            value: form.akses, onChange: (e) => setForm({ ...form, akses: e.target.value }),
            options: Object.entries(labelAkses).map(([value, label]) => ({ value, label })),
          })))),

    sandiUntuk && __h(Yn, {
      open: true, onClose: () => setSandiUntuk(null), title: `Ganti kata sandi @${sandiUntuk.username}`,
      footer: __h(__F, null,
        __h(be, { variant: "secondary", onClick: () => setSandiUntuk(null) }, "Batal"),
        __h(be, { onClick: gantiSandi }, "Simpan")),
    },
      __h(de, { label: "Kata sandi baru", hint: "Orang ini akan keluar dari semua perangkat dan masuk lagi dengan sandi baru." },
        __h(Fe, { type: "text", value: sandiBaru, onChange: (e) => setSandiBaru(e.target.value), autoFocus: true }))));
}

// ---------------------------------------------------------------- Robot 1 otomatis (GitHub)
function RaksaRobot1Cloud() {
  const R = window.__RAKSA;
  const [runs, setRuns] = w.useState(null);
  const [sibuk, setSibuk] = w.useState(false);
  const s = useRaksaStatus();
  const muat = async () => setRuns(await R.riwayatRobot1());
  w.useEffect(() => { muat(); }, [s.robotVersi]);
  const fmt = (x) => {
    if (!x) return "-";
    const d = new Date(x);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const menunggu = (runs || []).filter((r) => r.status === "BERHASIL" && r.file_path && !r.hasil).length;
  const tone = (r) => r.status === "GAGAL" || /^GAGAL/.test(r.hasil || "") ? "bad" : r.status === "BERJALAN" ? "wait" : r.hasil ? "ok" : "warn";
  const label = (r) => r.status === "GAGAL" ? "Gagal" : r.status === "BERJALAN" ? "Berjalan"
    : /^GAGAL/.test(r.hasil || "") ? "Gagal diproses" : r.hasil ? "Masuk Raksa" : "Menunggu diproses";
  return __h(ze, {
    title: "Robot 1 otomatis (server GitHub)",
    sub: "Mengambil pesanan 3 hari terakhir dari BigSeller setiap Senin–Sabtu pukul 09.00 dan 13.00 WIB",
    actions: __h(__F, null,
      menunggu > 0 && __h(be, {
        size: "sm", disabled: sibuk,
        onClick: async () => { setSibuk(true); await R.prosesInbox(true); setSibuk(false); muat(); },
      }, sibuk ? "Memproses…" : `Proses ${menunggu} file sekarang`),
      __h("a", {
        href: R.githubActions, target: "_blank", rel: "noopener",
        className: "inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-n-200 hover:bg-n-50",
      }, "Jalankan sekarang di GitHub")),
  },
    runs === null
      ? __h("p", { className: "text-sm text-n-500" }, "Memuat…")
      : runs.length === 0
        ? __h("p", { className: "text-sm text-n-500" }, "Belum ada riwayat. Robot pertama kali berjalan pada jadwal berikutnya, atau tekan “Jalankan sekarang di GitHub” lalu Run workflow.")
        : __h("div", { className: "divide-y divide-n-100 rounded-lg border border-n-100" },
          ...runs.map((r) => __h("div", { key: r.id, className: "flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]" },
            __h("span", { className: "shrink-0 text-n-500 tnum", style: { width: 118 } }, fmt(r.mulai)),
            __h(Le, { tone: tone(r) }, label(r)),
            __h("div", { className: "min-w-0 flex-1" },
              __h("div", { className: "font-medium text-n-900" }, r.keterangan || "Impor pesanan BigSeller"),
              (r.hasil || r.status === "GAGAL") && __h("div", { className: "text-n-600" }, r.hasil || r.keterangan),
              r.log_url && __h("a", { href: r.log_url, target: "_blank", rel: "noopener", className: "text-brand-700 underline" }, "Lihat log & tangkapan layar"))))),
    __h("p", { className: "mt-3 text-[12px] text-n-600" },
      "File dari robot diproses otomatis saat Raksa dibuka oleh Owner atau Admin. Pesanan yang sama tidak akan tercatat dobel."));
}

// ---------------------------------------------------------------- kamera scan
function RaksaKamera({ onKode }) {
  const ref = w.useRef(null);
  const [pesan, setPesan] = w.useState("Menyalakan kamera…");
  w.useEffect(() => {
    let stream = null, mati = false, timer = null;
    (async () => {
      if (!("BarcodeDetector" in window)) {
        setPesan("Kamera scan belum didukung browser ini. Ketik atau tempel nomornya di bawah, atau pakai alat scan barcode USB.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (mati) return;
        const v = ref.current;
        v.srcObject = stream;
        await v.play();
        setPesan("Arahkan kamera ke barcode / QR resi");
        // eslint-disable-next-line no-undef
        const det = new BarcodeDetector();
        const cek = async () => {
          if (mati) return;
          try {
            const h = await det.detect(v);
            if (h && h.length && h[0].rawValue) { onKode(h[0].rawValue.trim()); return; }
          } catch {}
          timer = setTimeout(cek, 250);
        };
        cek();
      } catch (e) {
        setPesan("Kamera tidak bisa dibuka (izin ditolak atau tidak ada kamera). Ketik nomornya di bawah.");
      }
    })();
    return () => { mati = true; clearTimeout(timer); stream && stream.getTracks().forEach((t) => t.stop()); };
  }, []);
  return __h("div", {
    className: "mb-4 flex aspect-video max-w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-black text-white/70",
    style: { position: "relative" },
  },
    __h("video", { ref, muted: true, playsInline: true, style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" } }),
    __h("span", { className: "text-xs", style: { position: "relative", background: "rgba(0,0,0,.45)", padding: "4px 8px", borderRadius: 6, textAlign: "center", maxWidth: "90%" } }, pesan));
}
