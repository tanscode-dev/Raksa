-- Raksa 1.0 — skema database
-- Data aplikasi disimpan per dokumen (satu baris per pesanan, kasus, pergerakan,
-- SKU, dst.) di tabel `dokumen`, sehingga logika Raksa yang sudah disetujui di
-- prototype tetap sama persis. Hak akses dijaga dengan RLS.

create extension if not exists pg_cron;

-- ================================================================ profil
create table if not exists public.profil (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  username  text not null unique,
  nama      text not null unique,          -- sama dengan nama di Master Karyawan
  akses     text not null check (akses in ('OWNER','ADMIN','KARYAWAN')),
  aktif     boolean not null default true,
  dibuat    timestamptz not null default now()
);
alter table public.profil enable row level security;

create or replace function public.akses_saya() returns text
language sql stable security definer set search_path = public as $$
  select akses from public.profil where user_id = auth.uid() and aktif
$$;
create or replace function public.nama_saya() returns text
language sql stable security definer set search_path = public as $$
  select nama from public.profil where user_id = auth.uid() and aktif
$$;

drop policy if exists profil_baca on public.profil;
create policy profil_baca on public.profil for select to authenticated
  using (user_id = auth.uid() or public.akses_saya() = 'OWNER');

-- ================================================================ dokumen
create table if not exists public.dokumen (
  koleksi     text not null,
  id          text not null,
  data        jsonb not null,
  tgl         timestamptz,                 -- tanggal pesanan (jendela muat & pembersihan)
  dihapus     boolean not null default false,
  diubah_pada timestamptz not null default clock_timestamp(),
  diubah_oleh uuid default auth.uid(),
  primary key (koleksi, id)
);
create index if not exists dokumen_diubah_idx on public.dokumen (diubah_pada);
create index if not exists dokumen_tgl_idx on public.dokumen (koleksi, tgl);
create index if not exists dokumen_kasus_nomor_idx on public.dokumen ((data->>'nomor')) where koleksi = 'cases';
alter table public.dokumen enable row level security;

create or replace function public.dokumen_cap() returns trigger
language plpgsql set search_path = public as $$
begin
  new.diubah_pada := clock_timestamp();
  new.diubah_oleh := coalesce(auth.uid(), new.diubah_oleh);
  return new;
end $$;
drop trigger if exists dokumen_cap on public.dokumen;
create trigger dokumen_cap before insert or update on public.dokumen
  for each row execute function public.dokumen_cap();

-- ================================================================ denda (hasil hitung)
-- Dihitung aplikasi Owner/Admin dan disimpan, supaya karyawan bisa melihat
-- dendanya sendiri tanpa ikut memuat data pesanan & kasus.
create table if not exists public.denda_hitung (
  id          text primary key,
  orang       text not null,
  data        jsonb not null,
  dihapus     boolean not null default false,
  diubah_pada timestamptz not null default clock_timestamp()
);
create index if not exists denda_orang_idx on public.denda_hitung (orang);
alter table public.denda_hitung enable row level security;
create or replace function public.denda_cap() returns trigger
language plpgsql set search_path = public as $$ begin new.diubah_pada := clock_timestamp(); return new; end $$;
drop trigger if exists denda_cap on public.denda_hitung;
create trigger denda_cap before insert or update on public.denda_hitung
  for each row execute function public.denda_cap();

-- ---- RLS dokumen
-- Koleksi tunggal (pengaturan, karyawan, toko, riwayat PIC rak) disimpan dengan
-- koleksi = '_tunggal' dan id = nama kuncinya. Harga modal disimpan terpisah di
-- koleksi 'skuModal' yang hanya bisa DIBACA Owner (admin boleh menulis, misalnya
-- saat upload pesanan memperbarui modal, tetapi tidak bisa membacanya).
create or replace function public.karyawan_boleh(k text, i text, d jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when k in ('skus','rakMap') then true
    when k = '_tunggal' then i in ('karyawan','rakHist','toko','settings')
    when k = 'cases' then d->>'jenis' = 'PENDING'
    when k = 'dendaMeta' then exists (select 1 from public.denda_hitung h
                                      where h.id = i and h.orang = public.nama_saya())
    else false end
$$;

drop policy if exists dok_baca on public.dokumen;
create policy dok_baca on public.dokumen for select to authenticated using (
  case public.akses_saya()
    when 'OWNER' then true
    when 'ADMIN' then koleksi <> 'skuModal'
    when 'KARYAWAN' then public.karyawan_boleh(koleksi, id, data)
    else false end);

drop policy if exists dok_tambah on public.dokumen;
create policy dok_tambah on public.dokumen for insert to authenticated with check (
  case public.akses_saya()
    when 'OWNER' then true
    when 'ADMIN' then true
    when 'KARYAWAN' then (koleksi = 'cases' and data->>'jenis' = 'PENDING')
                      or (koleksi = 'dendaMeta' and public.karyawan_boleh(koleksi, id, data))
    else false end);

drop policy if exists dok_ubah on public.dokumen;
create policy dok_ubah on public.dokumen for update to authenticated
  using (
    case public.akses_saya()
      when 'OWNER' then true
      when 'ADMIN' then true
      when 'KARYAWAN' then (koleksi = 'cases' and data->>'jenis' = 'PENDING')
                        or (koleksi = 'dendaMeta' and public.karyawan_boleh(koleksi, id, data))
      else false end)
  with check (
    case public.akses_saya()
      when 'OWNER' then true
      when 'ADMIN' then true
      when 'KARYAWAN' then (koleksi = 'cases' and data->>'jenis' = 'PENDING')
                        or (koleksi = 'dendaMeta' and public.karyawan_boleh(koleksi, id, data))
      else false end);
-- Tidak ada policy DELETE: penghapusan selalu soft delete (dihapus = true).

-- ---- RLS denda_hitung
drop policy if exists denda_baca on public.denda_hitung;
create policy denda_baca on public.denda_hitung for select to authenticated
  using (public.akses_saya() = 'OWNER' or orang = public.nama_saya());
drop policy if exists denda_tulis on public.denda_hitung;
create policy denda_tulis on public.denda_hitung for insert to authenticated
  with check (public.akses_saya() in ('OWNER','ADMIN'));
drop policy if exists denda_ubah on public.denda_hitung;
create policy denda_ubah on public.denda_hitung for update to authenticated
  using (public.akses_saya() in ('OWNER','ADMIN'))
  with check (public.akses_saya() in ('OWNER','ADMIN'));

-- ================================================================ audit
create table if not exists public.audit_log (
  id       bigint generated always as identity primary key,
  waktu    timestamptz not null default now(),
  oleh     text,
  aksi     text not null,
  user_id  uuid default auth.uid()
);
create index if not exists audit_waktu_idx on public.audit_log (waktu desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_tambah on public.audit_log;
create policy audit_tambah on public.audit_log for insert to authenticated
  with check (public.akses_saya() is not null);
drop policy if exists audit_baca on public.audit_log;
create policy audit_baca on public.audit_log for select to authenticated
  using (public.akses_saya() in ('OWNER','ADMIN'));

-- ================================================================ robot
create table if not exists public.robot_run (
  id            uuid primary key default gen_random_uuid(),
  robot         text not null check (robot in ('ROBOT1','ROBOT2')),
  sumber        text not null default 'GITHUB',   -- GITHUB / UIVISION
  mulai         timestamptz not null default now(),
  selesai       timestamptz,
  status        text not null default 'BERJALAN' check (status in ('BERJALAN','BERHASIL','GAGAL')),
  keterangan    text,
  hasil         text,
  oleh          text,
  file_path     text,                             -- file di storage robot-inbox
  dari_tgl      date,
  sampai_tgl    date,
  diproses_oleh uuid,
  diproses_pada timestamptz,
  log_url       text
);
create index if not exists robot_run_mulai_idx on public.robot_run (mulai desc);
alter table public.robot_run enable row level security;
drop policy if exists robot_baca on public.robot_run;
create policy robot_baca on public.robot_run for select to authenticated
  using (public.akses_saya() in ('OWNER','ADMIN'));
drop policy if exists robot_tambah on public.robot_run;
create policy robot_tambah on public.robot_run for insert to authenticated
  with check (public.akses_saya() in ('OWNER','ADMIN'));
drop policy if exists robot_ubah on public.robot_run;
create policy robot_ubah on public.robot_run for update to authenticated
  using (public.akses_saya() in ('OWNER','ADMIN'));

-- Klaim file Robot 1 untuk diproses. Atomik: hanya satu aplikasi yang mendapat
-- file yang sama walau beberapa orang membuka Raksa bersamaan.
create or replace function public.klaim_file_robot(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(public.akses_saya(),'') not in ('OWNER','ADMIN') then return false; end if;
  update public.robot_run set diproses_oleh = auth.uid(), diproses_pada = now()
   where id = p_id and file_path is not null and status = 'BERHASIL'
     and (diproses_oleh is null or (diproses_pada < now() - interval '15 minutes' and hasil is null));
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Kunci Robot 2: dua orang tidak bisa mengirim stok bersamaan.
create table if not exists public.kunci (
  nama          text primary key,
  dipegang_oleh text,
  user_id       uuid,
  sejak         timestamptz,
  sampai        timestamptz
);
alter table public.kunci enable row level security;
drop policy if exists kunci_baca on public.kunci;
create policy kunci_baca on public.kunci for select to authenticated
  using (public.akses_saya() in ('OWNER','ADMIN'));

create or replace function public.ambil_kunci(p_nama text, p_menit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.kunci;
begin
  if coalesce(public.akses_saya(),'') not in ('OWNER','ADMIN') then
    return jsonb_build_object('ok', false, 'pesan', 'Tidak punya akses');
  end if;
  insert into public.kunci(nama) values (p_nama) on conflict do nothing;
  select * into k from public.kunci where nama = p_nama for update;
  if k.sampai is not null and k.sampai > now() and k.user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'oleh', k.dipegang_oleh, 'sampai', k.sampai);
  end if;
  update public.kunci set dipegang_oleh = public.nama_saya(), user_id = auth.uid(),
         sejak = now(), sampai = now() + make_interval(mins => p_menit)
   where nama = p_nama;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.lepas_kunci(p_nama text) returns void
language sql security definer set search_path = public as $$
  update public.kunci set dipegang_oleh = null, user_id = null, sejak = null, sampai = null
   where nama = p_nama and (user_id = auth.uid() or public.akses_saya() = 'OWNER');
$$;

-- ================================================================ storage
insert into storage.buckets (id, name, public)
values ('robot-inbox', 'robot-inbox', false)
on conflict (id) do nothing;
-- Sesi login BigSeller milik robot: bucket privat tanpa policy (hanya kunci service).
insert into storage.buckets (id, name, public)
values ('robot-sesi', 'robot-sesi', false)
on conflict (id) do nothing;

drop policy if exists robot_inbox_baca on storage.objects;
create policy robot_inbox_baca on storage.objects for select to authenticated
  using (bucket_id = 'robot-inbox' and public.akses_saya() in ('OWNER','ADMIN'));
drop policy if exists robot_inbox_hapus on storage.objects;
create policy robot_inbox_hapus on storage.objects for delete to authenticated
  using (bucket_id = 'robot-inbox' and public.akses_saya() in ('OWNER','ADMIN'));

-- ================================================================ realtime
do $$ begin
  begin alter publication supabase_realtime add table public.dokumen;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.robot_run;
  exception when duplicate_object then null; end;
end $$;

