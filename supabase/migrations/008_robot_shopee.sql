-- Robot Shopee (Robot 3): ambil Laporan Penghasilan (Sudah Dilepas) & mutasi Saldo Penjual
-- dari Seller Centre lewat satu sub akun, lalu dititipkan ke Seller Fintech usaha pemiliknya.
-- Hanya robot (kunci service) yang menulis run & file; Seller Fintech membaca & menandai diimpor.

create table if not exists public.shopee_robot_run (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  status text not null default 'ANTRE' check (status in ('ANTRE','BERJALAN','MENUNGGU_OTP','BERHASIL','SEBAGIAN','GAGAL')),
  jenis text not null default 'MANUAL' check (jenis in ('MANUAL','MINGGUAN','BULANAN')),
  dari_tgl date not null,
  sampai_tgl date not null,
  oleh text,
  dibuat timestamptz not null default now(),
  mulai timestamptz,
  selesai timestamptz,
  hasil text,
  langkah text,
  log_url text,
  otp_minta timestamptz,
  otp_pesan text,
  otp_jawab text,
  debug_img text
);
create index if not exists shopee_robot_run_usaha on public.shopee_robot_run (company_id, dibuat desc);

create table if not exists public.shopee_toko_peta (
  company_id uuid not null references public.companies(id),
  nama_shopee text not null,
  toko_seller text,
  aktif boolean not null default true,
  ditemukan timestamptz not null default now(),
  diubah timestamptz not null default now(),
  primary key (company_id, nama_shopee)
);

create table if not exists public.shopee_robot_file (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  run_id uuid references public.shopee_robot_run(id),
  nama_shopee text not null,
  jenis text not null check (jenis in ('income','mutasi')),
  dari_tgl date,
  sampai_tgl date,
  path text not null,
  nama_file text,
  ukuran int,
  status text not null default 'baru' check (status in ('baru','diimpor','dilewati')),
  diimpor_pada timestamptz,
  diimpor_oleh text,
  dibuat timestamptz not null default now()
);
create index if not exists shopee_robot_file_usaha on public.shopee_robot_file (company_id, status, dibuat desc);

alter table public.shopee_robot_run enable row level security;
alter table public.shopee_toko_peta enable row level security;
alter table public.shopee_robot_file enable row level security;

create or replace function private.shopee_boleh(c uuid, ubah boolean default false) returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(private.punya_hak(c, 'seller.penghasilan.tambah')
    or (not ubah and private.punya_hak(c, 'seller.penghasilan.lihat')), false)
$$;

drop policy if exists shopee_run_baca on public.shopee_robot_run;
create policy shopee_run_baca on public.shopee_robot_run for select using (private.shopee_boleh(company_id));
drop policy if exists shopee_peta_baca on public.shopee_toko_peta;
create policy shopee_peta_baca on public.shopee_toko_peta for select using (private.shopee_boleh(company_id));
drop policy if exists shopee_file_baca on public.shopee_robot_file;
create policy shopee_file_baca on public.shopee_robot_file for select using (private.shopee_boleh(company_id));

-- penyimpanan file (privat, per usaha: <company_id>/...)
insert into storage.buckets (id, name, public, file_size_limit)
values ('shopee-inbox', 'shopee-inbox', false, 52428800)
on conflict (id) do nothing;
drop policy if exists shopee_inbox_baca on storage.objects;
create policy shopee_inbox_baca on storage.objects for select using (
  bucket_id = 'shopee-inbox' and private.shopee_boleh(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end));

-- picu workflow GitHub
create or replace function private.shopee_robot_picu(p_run uuid) returns bigint
language plpgsql security definer set search_path to '' as $$
declare t text := private.robot_github_token(); rid bigint; r public.shopee_robot_run;
begin
  select * into r from public.shopee_robot_run where id = p_run;
  if r.id is null then return null; end if;
  if t is null then
    update public.shopee_robot_run set status = 'GAGAL', selesai = now(), hasil = 'Token GitHub belum dipasang di Business Manager.' where id = p_run;
    return null;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/tanscode-dev/Raksa/actions/workflows/robot3-shopee.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('run_id', r.id::text)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || t, 'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'business-manager-jadwal', 'Content-Type', 'application/json'),
    timeout_milliseconds := 20000) into rid;
  return rid;
end $$;

-- jadwal: Senin = 14 hari terakhir; tanggal 3 = bulan lalu penuh. Hanya usaha yang sub akunnya terpasang.
create or replace function private.shopee_robot_jadwal(p_jenis text) returns void
language plpgsql security definer set search_path to '' as $$
declare c uuid := public.raksa_company(); hari date := (now() at time zone 'Asia/Jakarta')::date; d1 date; d2 date; v uuid;
begin
  if exists (select 1 from public.shopee_robot_run where company_id = c and status in ('ANTRE','BERJALAN','MENUNGGU_OTP') and dibuat > now() - interval '2 hours') then return; end if;
  if p_jenis = 'BULANAN' then
    d1 := (date_trunc('month', hari) - interval '1 month')::date; d2 := (date_trunc('month', hari) - interval '1 day')::date;
  else
    d1 := hari - 14; d2 := hari - 1;
  end if;
  insert into public.shopee_robot_run(company_id, jenis, dari_tgl, sampai_tgl, oleh) values (c, p_jenis, d1, d2, 'Jadwal Business Manager') returning id into v;
  perform private.shopee_robot_picu(v);
end $$;

-- tombol "Ambil sekarang" (Pemilik / yang boleh menambah Penghasilan Marketplace)
create or replace function public.shopee_robot_jalankan(p_company uuid, p_dari date, p_sampai date) returns uuid
language plpgsql security definer set search_path to '' as $$
declare v uuid; nm text;
begin
  if not private.shopee_boleh(p_company, true) then raise exception 'Tidak punya akses' using errcode = '42501'; end if;
  if p_company is distinct from public.raksa_company() then raise exception 'Robot Shopee belum dipasang untuk usaha ini'; end if;
  if p_dari is null or p_sampai is null or p_sampai < p_dari then raise exception 'Rentang tanggal tidak sah'; end if;
  if p_sampai - p_dari > 92 then raise exception 'Rentang maksimal 3 bulan'; end if;
  if exists (select 1 from public.shopee_robot_run where company_id = p_company and status in ('ANTRE','BERJALAN','MENUNGGU_OTP') and dibuat > now() - interval '2 hours') then
    raise exception 'Robot Shopee sedang berjalan. Tunggu sampai selesai.';
  end if;
  select coalesce(nullif(full_name,''), email) into nm from public.profiles where user_id = auth.uid();
  insert into public.shopee_robot_run(company_id, jenis, dari_tgl, sampai_tgl, oleh) values (p_company, 'MANUAL', p_dari, p_sampai, nm) returning id into v;
  perform private.shopee_robot_picu(v);
  return v;
end $$;

-- kode OTP diketik di Seller Fintech
create or replace function public.shopee_robot_otp(p_run uuid, p_kode text) returns boolean
language plpgsql security definer set search_path to '' as $$
declare c uuid;
begin
  select company_id into c from public.shopee_robot_run where id = p_run and status = 'MENUNGGU_OTP';
  if c is null or not private.shopee_boleh(c, true) then return false; end if;
  update public.shopee_robot_run set otp_jawab = left(trim(p_kode), 12) where id = p_run;
  return true;
end $$;

-- pemetaan toko Shopee → nama toko di Seller Fintech
create or replace function public.shopee_toko_atur(p_company uuid, p_nama_shopee text, p_toko text, p_aktif boolean default true) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not private.shopee_boleh(p_company, true) then raise exception 'Tidak punya akses' using errcode = '42501'; end if;
  update public.shopee_toko_peta set toko_seller = nullif(trim(p_toko), ''), aktif = coalesce(p_aktif, true), diubah = now()
   where company_id = p_company and nama_shopee = p_nama_shopee;
end $$;

-- tandai file sudah diimpor / dilewati
create or replace function public.shopee_file_tandai(p_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path to '' as $$
declare c uuid; nm text;
begin
  if p_status not in ('baru','diimpor','dilewati') then raise exception 'Status tidak dikenal'; end if;
  select company_id into c from public.shopee_robot_file where id = p_id;
  if c is null or not private.shopee_boleh(c, true) then return false; end if;
  select coalesce(nullif(full_name,''), email) into nm from public.profiles where user_id = auth.uid();
  update public.shopee_robot_file set status = p_status,
    diimpor_pada = case when p_status = 'baru' then null else now() end,
    diimpor_oleh = case when p_status = 'baru' then null else nm end
   where id = p_id;
  return true;
end $$;

revoke all on function private.shopee_robot_picu(uuid) from public, anon, authenticated;
revoke all on function private.shopee_robot_jadwal(text) from public, anon, authenticated;

-- jadwal (UTC): Senin 06.40 WIB & tanggal 3 jam 10.10 WIB (beda jam supaya tidak bentrok bila tanggal 3 jatuh hari Senin)
select cron.schedule('robot-shopee-mingguan-senin', '40 23 * * 0', $$select private.shopee_robot_jadwal('MINGGUAN')$$);
select cron.schedule('robot-shopee-bulanan-tgl3', '10 3 3 * *', $$select private.shopee_robot_jadwal('BULANAN')$$);

-- jejak langkah robot (untuk perbaikan bila tampilan Shopee berubah)
alter table public.shopee_robot_run add column if not exists jejak jsonb not null default '[]'::jsonb;

-- mode eksplor (hanya login & membaca daftar toko) untuk percobaan pertama
alter table public.shopee_robot_run add column if not exists mode text not null default 'biasa' check (mode in ('biasa','eksplor'));
-- shopee_robot_picu mengirim input mode; shopee_robot_jalankan(p_company, p_dari, p_sampai, p_mode default 'biasa')
-- (lihat definisi terbaru di database; versi 3 argumen sudah dilepas)
