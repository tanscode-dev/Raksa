// Supabase tiruan untuk uji otomatis Raksa (tanpa menyentuh server sungguhan).
// Menyimpan tabel di memori & mencatat setiap tulisan ke window.__MOCK.
const M = (window.__MOCK = window.__MOCK || {
  tabel: { profil: [], dokumen: [], denda_hitung: [], audit_log: [], robot_run: [], kunci: [] },
  storage: {},
  log: [],
  sesi: null,
});
const PROFIL = { user_id: "u-owner", username: "tim", nama: "TIM", akses: "OWNER", aktif: true };
if (!M.tabel.profil.length) M.tabel.profil.push(PROFIL);

function cocok(row, f) {
  const v = f.kol.includes("->>") ? (row[f.kol.split("->>")[0]] || {})[f.kol.split("->>")[1]] : row[f.kol];
  switch (f.op) {
    case "eq": return v === f.val;
    case "gt": return v > f.val;
    case "in": return f.val.includes(v);
    case "is": return f.val === null ? v == null : v === f.val;
    case "notis": return f.val === null ? v != null : v !== f.val;
    default: return true;
  }
}

class Q {
  constructor(t) { this.t = t; this.f = []; this.mode = "select"; this.head = false; this.rng = null; this.lim = null; this.single = false; }
  select(cols, opt) { if (this.mode === "select") this.mode = "select"; this.head = !!(opt && opt.head); return this; }
  eq(k, v) { this.f.push({ kol: k, op: "eq", val: v }); return this; }
  gt(k, v) { this.f.push({ kol: k, op: "gt", val: v }); return this; }
  in(k, v) { this.f.push({ kol: k, op: "in", val: v }); return this; }
  is(k, v) { this.f.push({ kol: k, op: "is", val: v }); return this; }
  not(k, op, v) { this.f.push({ kol: k, op: "notis", val: v }); return this; }
  or() { return this; }
  order() { return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.single = true; return this; }
  insert(rows) { this.mode = "insert"; this.rows = [].concat(rows); return this; }
  upsert(rows, opt) { this.mode = "upsert"; this.rows = [].concat(rows); this.opt = opt; return this; }
  update(v) { this.mode = "update"; this.val = v; return this; }
  then(res, rej) { return Promise.resolve(this.jalan()).then(res, rej); }
  jalan() {
    const T = M.tabel[this.t] || (M.tabel[this.t] = []);
    if (this.mode === "insert") { this.rows.forEach((r) => T.push({ ...r })); M.log.push({ t: this.t, op: "insert", n: this.rows.length, rows: this.rows }); return { data: null, error: null }; }
    if (this.mode === "upsert") {
      const kunci = (this.opt && this.opt.onConflict || "id").split(",");
      for (const r of this.rows) {
        const i = T.findIndex((x) => kunci.every((k) => x[k] === r[k]));
        const baru = { ...r, diubah_pada: new Date().toISOString() };
        if (i >= 0) T[i] = { ...T[i], ...baru }; else T.push(baru);
      }
      M.log.push({ t: this.t, op: "upsert", n: this.rows.length, rows: this.rows });
      return { data: null, error: null };
    }
    let data = T.filter((r) => this.f.every((f) => cocok(r, f)));
    if (this.mode === "update") { data.forEach((r) => Object.assign(r, this.val)); M.log.push({ t: this.t, op: "update", val: this.val }); return { data: null, error: null }; }
    if (this.head) return { count: data.length, data: null, error: null };
    if (this.rng) data = data.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim) data = data.slice(0, this.lim);
    if (this.single) return { data: data[0] || null, error: null };
    return { data: JSON.parse(JSON.stringify(data)), error: null };
  }
}

export function createClient() {
  const dengar = [];
  return {
    auth: {
      async getSession() { return { data: { session: M.sesi } }; },
      async signInWithPassword({ email, password }) {
        if (email === "tim@raksa.invalid" && password === "rahasia1") {
          M.sesi = { access_token: "t", user: { id: "u-owner" } };
          return { data: {}, error: null };
        }
        return { error: { message: "Invalid login credentials" } };
      },
      async signOut() { M.sesi = null; return {}; },
      async updateUser() { return { error: null }; },
      onAuthStateChange(fn) { dengar.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from(t) { return new Q(t); },
    async rpc(nama, arg) {
      M.log.push({ rpc: nama, arg });
      if (nama === "klaim_file_robot") { const r = M.tabel.robot_run.find((x) => x.id === arg.p_id); if (r && !r.diproses_oleh) { r.diproses_oleh = "u-owner"; r.diproses_pada = new Date().toISOString(); return { data: true }; } return { data: false }; }
      if (nama === "ambil_kunci") return { data: { ok: true } };
      return { data: null };
    },
    storage: {
      from() {
        return {
          async download(p) { const b = M.storage[p]; return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "not found" } }; },
          async remove(ps) { ps.forEach((p) => delete M.storage[p]); M.log.push({ storageRemove: ps }); return {}; },
        };
      },
    },
    channel() {
      const c = { on() { return c; }, subscribe(fn) { fn && fn("SUBSCRIBED"); return c; } };
      return c;
    },
  };
}
