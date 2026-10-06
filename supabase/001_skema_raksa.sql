-- Raksa 1.0 — skema database (Supabase / Postgres)
-- Prinsip: hanya data inti, tanpa data pribadi pembeli; file Excel tidak disimpan permanen.

-- 1) Profil pengguna (login per karyawan)
create table if not exists public.profil (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  nama        text not null,
  peran       text not null check (peran in ('OWNER','ADMIN','KARYAWAN')),
  full_akses  boolean not null default false,
  aktif       boolean not null default true,
  dibuat      timestamptz not null default now()
);

create or replace function public.pengguna_aktif() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profil where user_id = auth.uid() and aktif)
$$;

create or replace function public.pengguna_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profil where user_id = auth.uid() and aktif and (peran = 'OWNER' or full_akses))
$$;

-- 2) Data aplikasi per koleksi (pesanan, kasus, pergerakan, sku, karyawan, rak, upload, batch ekspor, audit, pengaturan)
create table if not exists public.data_raksa (
  koleksi     text not null,
  id          text not null,
  data        jsonb not null,
  tanggal     date,                      -- tanggal acuan (mis. tanggal pesanan) untuk pembersihan & filter
  diubah      timestamptz not null default now(),
  diubah_oleh uuid default auth.uid(),
  primary key (koleksi, id)
);
create index if not exists data_raksa_koleksi_diubah on public.data_raksa (koleksi, diubah desc);
create index if not exists data_raksa_koleksi_tanggal on public.data_raksa (koleksi, tanggal);

-- 3) Riwayat robot (Robot 1 GitHub Actions & Robot 2 UI.Vision)
create table if not exists public.robot_run (
  id          uuid primary key default gen_random_uuid(),
  robot       text not null check (robot in ('ROBOT1','ROBOT2')),
  sumber      text not null default 'github',
  status      text not null default 'PROSES' check (status in ('PROSES','OK','GAGAL')),
  judul       text,
  detail      text,
  file_path   text,                      -- file di storage menunggu diproses Raksa
  diproses    timestamptz,
  mulai       timestamptz not null default now(),
  selesai     timestamptz,
  oleh        text
);
create index if not exists robot_run_mulai on public.robot_run (mulai desc);

-- 4) Kunci supaya Robot 2 tidak jalan dobel
create table if not exists public.robot_kunci (
  robot   text primary key,
  pemegang text not null,
  sampai  timestamptz not null
);

create or replace function public.ambil_kunci(p_robot text, p_pemegang text, p_menit int default 30)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.pengguna_aktif() then return false; end if;
  insert into public.robot_kunci(robot, pemegang, sampai)
  values (p_robot, p_pemegang, now() + make_interval(mins => p_menit))
  on conflict (robot) do update set pemegang = excluded.pemegang, sampai = excluded.sampai
  where public.robot_kunci.sampai < now() or public.robot_kunci.pemegang = excluded.pemegang;
  return found;
end $$;

create or replace function public.lepas_kunci(p_robot text, p_pemegang text)
returns void language sql security definer set search_path = public as $$
  delete from public.robot_kunci where robot = p_robot and pemegang = p_pemegang
$$;

-- 5) RLS
alter table public.profil      enable row level security;
alter table public.data_raksa  enable row level security;
alter table public.robot_run   enable row level security;
alter table public.robot_kunci enable row level security;

create policy profil_baca  on public.profil for select to authenticated using (public.pengguna_aktif() or user_id = auth.uid());
create policy profil_owner on public.profil for all    to authenticated using (public.pengguna_owner()) with check (public.pengguna_owner());

create policy data_baca  on public.data_raksa for select to authenticated using (public.pengguna_aktif());
create policy data_tulis on public.data_raksa for insert to authenticated with check (public.pengguna_aktif());
create policy data_ubah  on public.data_raksa for update to authenticated using (public.pengguna_aktif()) with check (public.pengguna_aktif());
create policy data_hapus on public.data_raksa for delete to authenticated using (public.pengguna_owner());

create policy robot_baca  on public.robot_run for select to authenticated using (public.pengguna_aktif());
create policy robot_tulis on public.robot_run for insert to authenticated with check (public.pengguna_aktif());
create policy robot_ubah  on public.robot_run for update to authenticated using (public.pengguna_aktif());

create policy kunci_baca on public.robot_kunci for select to authenticated using (public.pengguna_aktif());

-- 6) Storage: file pesanan dari Robot 1 (dihapus setelah diproses)
insert into storage.buckets (id, name, public, file_size_limit)
values ('robot-pesanan', 'robot-pesanan', false, 10485760)
on conflict (id) do nothing;

create policy robot_file_baca on storage.objects for select to authenticated
  using (bucket_id = 'robot-pesanan' and public.pengguna_aktif());
create policy robot_file_hapus on storage.objects for delete to authenticated
  using (bucket_id = 'robot-pesanan' and public.pengguna_aktif());

-- 7) Pembersihan otomatis supaya database tetap kecil
create extension if not exists pg_cron;
select cron.schedule('raksa-bersih-harian', '30 17 * * *', $$
  delete from public.robot_run where mulai < now() - interval '180 days';
  delete from public.data_raksa where koleksi = 'audit'   and diubah  < now() - interval '365 days';
  delete from public.data_raksa where koleksi = 'pesanan' and tanggal < (now() - interval '400 days')::date
    and not exists (select 1 from public.data_raksa k where k.koleksi = 'kasus' and k.data->>'orderId' = public.data_raksa.id);
  delete from public.robot_kunci where sampai < now() - interval '1 day';
$$);
