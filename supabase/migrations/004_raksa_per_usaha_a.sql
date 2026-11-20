-- Raksa per usaha (tahap A): setiap baris Raksa punya company_id.
-- Data lama otomatis milik Dunia Gelang (raksa_company()). Tidak ada data yang dihapus.
-- Kunci lama (koleksi,id) dibiarkan dulu supaya aplikasi & robot versi lama tetap jalan;
-- dilepas di tahap B setelah aplikasi & robot baru terpasang.

-- 0) cadangan lengkap
create table if not exists private.cadangan_dokumen_20261120 as select * from public.dokumen;
create table if not exists private.cadangan_denda_hitung_20261120 as select * from public.denda_hitung;
create table if not exists private.cadangan_rk_audit_20261120 as select * from public.rk_audit_log;

-- 1) usaha aktif untuk Raksa
create or replace function public.raksa_usaha_saya() returns uuid
language sql stable security definer set search_path to '' as $$
  select m.company_id
    from public.memberships m
    left join public.profiles p on p.user_id = m.user_id
   where m.user_id = (select auth.uid()) and m.status = 'active'
     and (m.role = 'owner' or private.member_perms(m.company_id, m.role, m.custom_role_id, m.role_ids)
          && array['raksa_lihat','raksa_input','raksa_pengaturan'])
   order by (m.company_id = p.default_company_id) desc nulls last, (m.company_id = public.raksa_company()) desc, m.created_at
   limit 1
$$;

create or replace function public.akses_saya() returns text
language sql stable security definer set search_path to 'public' as $$
  select case
    when m.role = 'owner' then case when private.jwt_aal2() or private.usaha_demo(m.company_id) then 'OWNER' end
    when 'raksa_pengaturan' = any(p.perms) then 'OWNER'
    when 'raksa_input' = any(p.perms) then 'ADMIN'
    when 'raksa_lihat' = any(p.perms) then 'KARYAWAN'
  end
  from public.memberships m
  cross join lateral (select private.member_perms(m.company_id, m.role, m.custom_role_id, m.role_ids) perms) p
  where m.user_id = auth.uid() and m.company_id = public.raksa_usaha_saya() and m.status = 'active'
  limit 1
$$;

-- Robot 1 & 2 hanya untuk Dunia Gelang
create or replace function public.akses_robot() returns text
language sql stable security definer set search_path to 'public' as $$
  select case when public.raksa_usaha_saya() = public.raksa_company() then public.akses_saya() end
$$;

create or replace function public.raksa_akses_anggota(p_user uuid, p_company uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select case
    when m.role = 'owner' then 'OWNER'
    when 'raksa_pengaturan' = any(p.perms) then 'OWNER'
    when 'raksa_input' = any(p.perms) then 'ADMIN'
    when 'raksa_lihat' = any(p.perms) then 'KARYAWAN'
  end
  from public.memberships m
  cross join lateral (select private.member_perms(m.company_id, m.role, m.custom_role_id, m.role_ids) perms) p
  where m.user_id = p_user and m.company_id = p_company
  limit 1
$$;
create or replace function public.raksa_akses_anggota(p_user uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select public.raksa_akses_anggota(p_user, coalesce(public.raksa_usaha_saya(), public.raksa_company()))
$$;

-- profil: anggota Raksa di usaha aktif. Kunci service (robot & fungsi server Raksa) tetap hanya Dunia Gelang.
create or replace view public.profil as
 select m.user_id,
    split_part(u.email::text, '@', 1) as username,
    coalesce(n.nama, nullif(upper(trim(both from pr.full_name)), ''), upper(split_part(u.email::text, '@', 1))) as nama,
    a.akses,
    (m.status = 'active') as aktif,
    m.created_at as dibuat,
    m.company_id
   from public.memberships m
     join auth.users u on u.id = m.user_id
     left join public.profiles pr on pr.user_id = m.user_id
     left join public.raksa_nama n on n.user_id = m.user_id
     cross join lateral (select public.raksa_akses_anggota(m.user_id, m.company_id) as akses) a
  where a.akses is not null
    and ((m.company_id = public.raksa_usaha_saya() and (m.user_id = auth.uid() or public.akses_saya() = 'OWNER'))
      or (auth.role() = 'service_role' and m.company_id = public.raksa_company()));

-- 2) kolom company_id (nilai lama = Dunia Gelang; tanpa memicu trigger / mengubah diubah_pada)
alter table public.dokumen add column if not exists company_id uuid not null default 'fdd98c7e-d5a6-4ffa-b482-6d0d32f1bf49';
alter table public.denda_hitung add column if not exists company_id uuid not null default 'fdd98c7e-d5a6-4ffa-b482-6d0d32f1bf49';
alter table public.rk_audit_log add column if not exists company_id uuid not null default 'fdd98c7e-d5a6-4ffa-b482-6d0d32f1bf49';
alter table public.dokumen alter column company_id drop default;
alter table public.denda_hitung alter column company_id drop default;
alter table public.rk_audit_log alter column company_id drop default;

create unique index if not exists dokumen_usaha_kunci on public.dokumen (company_id, koleksi, id);
create unique index if not exists denda_hitung_usaha_kunci on public.denda_hitung (company_id, id);
create index if not exists rk_audit_usaha_waktu on public.rk_audit_log (company_id, waktu desc);

-- isi company_id otomatis: pengguna → usaha aktif; kunci service (robot) → Dunia Gelang. Tidak boleh dipindah.
create or replace function private.raksa_isi_usaha() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' then
    new.company_id := coalesce(new.company_id, public.raksa_usaha_saya(), public.raksa_company());
  elsif new.company_id is distinct from old.company_id then
    raise exception 'Data Raksa tidak bisa dipindah ke usaha lain' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists raksa_isi_usaha on public.dokumen;
create trigger raksa_isi_usaha before insert or update on public.dokumen for each row execute function private.raksa_isi_usaha();
drop trigger if exists raksa_isi_usaha on public.denda_hitung;
create trigger raksa_isi_usaha before insert or update on public.denda_hitung for each row execute function private.raksa_isi_usaha();
drop trigger if exists raksa_isi_usaha on public.rk_audit_log;
create trigger raksa_isi_usaha before insert or update on public.rk_audit_log for each row execute function private.raksa_isi_usaha();

-- 3) aturan akses per usaha
drop policy if exists dok_baca on public.dokumen;
create policy dok_baca on public.dokumen for select using (
  company_id = (select public.raksa_usaha_saya()) and
  case (select public.akses_saya())
    when 'OWNER' then true
    when 'ADMIN' then koleksi <> 'skuModal'
    when 'KARYAWAN' then public.karyawan_boleh(koleksi, id, data)
    else false end);
drop policy if exists dok_tambah on public.dokumen;
create policy dok_tambah on public.dokumen for insert with check (
  company_id = (select public.raksa_usaha_saya()) and
  case (select public.akses_saya())
    when 'OWNER' then true
    when 'ADMIN' then true
    when 'KARYAWAN' then (koleksi = 'cases' and data->>'jenis' = 'PENDING') or (koleksi = 'dendaMeta' and public.karyawan_boleh(koleksi, id, data))
    else false end);
drop policy if exists dok_ubah on public.dokumen;
create policy dok_ubah on public.dokumen for update using (
  company_id = (select public.raksa_usaha_saya()) and
  case (select public.akses_saya())
    when 'OWNER' then true
    when 'ADMIN' then true
    when 'KARYAWAN' then (koleksi = 'cases' and data->>'jenis' = 'PENDING') or (koleksi = 'dendaMeta' and public.karyawan_boleh(koleksi, id, data))
    else false end)
  with check (
  company_id = (select public.raksa_usaha_saya()) and
  case (select public.akses_saya())
    when 'OWNER' then true
    when 'ADMIN' then true
    when 'KARYAWAN' then (koleksi = 'cases' and data->>'jenis' = 'PENDING') or (koleksi = 'dendaMeta' and public.karyawan_boleh(koleksi, id, data))
    else false end);

drop policy if exists denda_baca on public.denda_hitung;
create policy denda_baca on public.denda_hitung for select using (
  company_id = (select public.raksa_usaha_saya()) and
  ((select public.akses_saya()) = 'OWNER' or orang = (select public.nama_saya())));
drop policy if exists denda_tulis on public.denda_hitung;
create policy denda_tulis on public.denda_hitung for insert with check (
  company_id = (select public.raksa_usaha_saya()) and (select public.akses_saya()) in ('OWNER','ADMIN'));
drop policy if exists denda_ubah on public.denda_hitung;
create policy denda_ubah on public.denda_hitung for update using (
  company_id = (select public.raksa_usaha_saya()) and (select public.akses_saya()) in ('OWNER','ADMIN'))
  with check (company_id = (select public.raksa_usaha_saya()) and (select public.akses_saya()) in ('OWNER','ADMIN'));

drop policy if exists rk_audit_baca on public.rk_audit_log;
create policy rk_audit_baca on public.rk_audit_log for select using (
  company_id = (select public.raksa_usaha_saya()) and (select public.akses_saya()) in ('OWNER','ADMIN'));
drop policy if exists rk_audit_tambah on public.rk_audit_log;
create policy rk_audit_tambah on public.rk_audit_log for insert with check (
  company_id = (select public.raksa_usaha_saya()) and (select public.akses_saya()) is not null);

drop policy if exists raksa_nama_baca on public.raksa_nama;
create policy raksa_nama_baca on public.raksa_nama for select using (
  user_id = (select auth.uid())
  or ((select public.akses_saya()) = 'OWNER' and exists (
    select 1 from public.memberships m where m.user_id = raksa_nama.user_id and m.status = 'active'
      and m.company_id = (select public.raksa_usaha_saya()))));

-- robot: hanya Dunia Gelang
drop policy if exists kunci_baca on public.kunci;
create policy kunci_baca on public.kunci for select using ((select public.akses_robot()) in ('OWNER','ADMIN'));
drop policy if exists robot_baca on public.robot_run;
create policy robot_baca on public.robot_run for select using ((select public.akses_robot()) in ('OWNER','ADMIN'));
drop policy if exists robot_tambah on public.robot_run;
create policy robot_tambah on public.robot_run for insert with check ((select public.akses_robot()) in ('OWNER','ADMIN'));
drop policy if exists robot_ubah on public.robot_run;
create policy robot_ubah on public.robot_run for update using ((select public.akses_robot()) in ('OWNER','ADMIN'));
drop policy if exists robot_inbox_baca on storage.objects;
create policy robot_inbox_baca on storage.objects for select using (bucket_id = 'robot-inbox' and public.akses_robot() in ('OWNER','ADMIN'));
drop policy if exists robot_inbox_hapus on storage.objects;
create policy robot_inbox_hapus on storage.objects for delete using (bucket_id = 'robot-inbox' and public.akses_robot() in ('OWNER','ADMIN'));

create or replace function public.klaim_file_robot(p_id uuid) returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if coalesce(public.akses_robot(),'') not in ('OWNER','ADMIN') then return false; end if;
  update public.robot_run set diproses_oleh = auth.uid(), diproses_pada = now()
   where id = p_id and file_path is not null and status = 'BERHASIL'
     and (diproses_oleh is null or (diproses_pada < now() - interval '15 minutes' and hasil is null));
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.ambil_kunci(p_nama text, p_menit integer default 20) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare k public.kunci;
begin
  if coalesce(public.akses_robot(),'') not in ('OWNER','ADMIN') then
    return jsonb_build_object('ok', false, 'pesan', 'Tidak punya akses');
  end if;
  insert into public.kunci(nama) values (p_nama) on conflict do nothing;
  select * into k from public.kunci where nama = p_nama for update;
  if k.sampai is not null and k.sampai > now() and k.user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'oleh', k.dipegang_oleh, 'sampai', k.sampai);
  end if;
  update public.kunci set dipegang_oleh = public.nama_saya(), user_id = auth.uid(),
         sejak = now(), sampai = now() + make_interval(mins => p_menit) where nama = p_nama;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.lepas_kunci(p_nama text) returns void
language sql security definer set search_path to 'public' as $$
  update public.kunci set dipegang_oleh = null, user_id = null, sejak = null, sampai = null
   where nama = p_nama and (user_id = auth.uid() or public.akses_robot() = 'OWNER');
$$;
