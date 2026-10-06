// Edge Function "kelola-akun" — Raksa 1.0
//
// Satu-satunya tempat yang membuat & mengubah akun login, karena butuh kunci
// service_role (melewati RLS) yang tidak boleh ada di halaman web.
//
// Login memakai NAMA PENGGUNA + kata sandi. Di balik layar, Supabase Auth butuh
// email, jadi dibuat alamat buatan <username>@raksa.invalid (tidak ada surel
// yang dikirim; domain .invalid memang tidak pernah ada).
//
// Tindakan:
//   status        → { adaOwner }                 (boleh tanpa login)
//   daftar-owner  → akun OWNER pertama            (hanya bila belum ada akun sama sekali)
//   buat          → akun baru (OWNER saja)
//   sandi         → ganti kata sandi akun lain (OWNER saja)
//   ubah          → ubah akses / nama / aktif (OWNER saja)
//   daftar        → daftar akun (OWNER saja)

import { createClient } from "jsr:@supabase/supabase-js@2";

const DOMAIN = "raksa.invalid";
const AKSES = ["OWNER", "ADMIN", "KARYAWAN"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const balas = (status: number, isi: unknown) =>
  new Response(JSON.stringify(isi), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const cekUsername = (u: string) => /^[a-z0-9._-]{3,24}$/.test(u);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return balas(405, { pesan: "Metode tidak didukung." });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const badan = await req.json().catch(() => ({}));
  const aksi = String(badan.aksi ?? "");

  const { count: jumlahAkun } = await admin
    .from("profil").select("*", { count: "exact", head: true });

  if (aksi === "status") return balas(200, { adaOwner: (jumlahAkun ?? 0) > 0 });

  if (aksi === "daftar-owner") {
    if ((jumlahAkun ?? 0) > 0)
      return balas(403, { pesan: "Owner sudah terdaftar. Silakan masuk." });
    return await buatAkun(admin, { ...badan, akses: "OWNER" });
  }

  // ---- tindakan lain: harus OWNER yang sedang login --------------------------
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return balas(401, { pesan: "Sesi Anda berakhir. Masuk kembali." });
  const { data: saya } = await admin.from("profil").select("akses,aktif")
    .eq("user_id", user.id).maybeSingle();
  if (!saya || !saya.aktif || saya.akses !== "OWNER")
    return balas(403, { pesan: "Hanya Owner yang boleh mengelola akun." });

  if (aksi === "daftar") {
    const { data, error } = await admin.from("profil")
      .select("user_id,username,nama,akses,aktif,dibuat").order("dibuat");
    if (error) return balas(400, { pesan: error.message });
    return balas(200, { akun: data });
  }

  if (aksi === "buat") return await buatAkun(admin, badan);

  const target = String(badan.user_id ?? "");
  const { data: t } = await admin.from("profil").select("user_id,akses")
    .eq("user_id", target).maybeSingle();
  if (!t) return balas(404, { pesan: "Akun tidak ditemukan." });

  if (aksi === "sandi") {
    const sandi = String(badan.sandi ?? "");
    if (sandi.length < 6) return balas(400, { pesan: "Kata sandi minimal 6 karakter." });
    const { error } = await admin.auth.admin.updateUserById(target, { password: sandi });
    if (error) return balas(400, { pesan: error.message });
    if (target !== user.id) await admin.auth.admin.signOut(target, "global").catch(() => {});
    return balas(200, { ok: true });
  }

  if (aksi === "ubah") {
    const ubah: Record<string, unknown> = {};
    if (badan.akses !== undefined) {
      if (!AKSES.includes(badan.akses)) return balas(400, { pesan: "Akses tidak dikenal." });
      ubah.akses = badan.akses;
    }
    if (badan.nama !== undefined) {
      const nama = String(badan.nama).trim().toUpperCase();
      if (!nama) return balas(400, { pesan: "Nama wajib diisi." });
      ubah.nama = nama;
    }
    if (badan.aktif !== undefined) ubah.aktif = !!badan.aktif;
    if (target === user.id && (ubah.aktif === false || (ubah.akses && ubah.akses !== "OWNER")))
      return balas(400, { pesan: "Anda tidak bisa menonaktifkan atau menurunkan akses akun sendiri." });
    const { error } = await admin.from("profil").update(ubah).eq("user_id", target);
    if (error)
      return balas(400, {
        pesan: /duplicate|unique/i.test(error.message) ? "Nama itu sudah dipakai akun lain." : error.message,
      });
    if (ubah.aktif === false) await admin.auth.admin.signOut(target, "global").catch(() => {});
    return balas(200, { ok: true });
  }

  return balas(400, { pesan: "Tindakan tidak dikenal." });
});

// deno-lint-ignore no-explicit-any
async function buatAkun(admin: any, badan: any) {
  const username = String(badan.username ?? "").trim().toLowerCase();
  const sandi = String(badan.sandi ?? "");
  const nama = String(badan.nama ?? "").trim().toUpperCase();
  const akses = String(badan.akses ?? "");
  if (!cekUsername(username))
    return balas(400, { pesan: "Nama pengguna 3–24 karakter: huruf kecil, angka, titik, garis bawah, atau strip." });
  if (sandi.length < 6) return balas(400, { pesan: "Kata sandi minimal 6 karakter." });
  if (!nama) return balas(400, { pesan: "Nama karyawan wajib diisi." });
  if (!AKSES.includes(akses)) return balas(400, { pesan: "Akses tidak dikenal." });

  const { data: baru, error } = await admin.auth.admin.createUser({
    email: `${username}@${DOMAIN}`,
    password: sandi,
    email_confirm: true,
    user_metadata: { username, nama },
  });
  if (error)
    return balas(400, {
      pesan: /already|exists|registered/i.test(error.message)
        ? "Nama pengguna itu sudah dipakai." : error.message,
    });
  const { error: e2 } = await admin.from("profil").insert({
    user_id: baru.user.id, username, nama, akses, aktif: true,
  });
  if (e2) {
    await admin.auth.admin.deleteUser(baru.user.id);
    return balas(400, {
      pesan: /duplicate|unique/i.test(e2.message) ? "Nama itu sudah dipakai akun lain." : e2.message,
    });
  }
  return balas(200, { ok: true, user_id: baru.user.id, username, nama, akses });
}
