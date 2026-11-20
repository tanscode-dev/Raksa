-- Raksa per usaha (tahap 2): fungsi penghubung Raksa ↔ BM (Katalog, Payroll, Seller, borongan) per usaha.

create or replace function public.karyawan_boleh(k text, i text, d jsonb) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select case
    when k in ('skus','rakMap') then true
    when k = '_tunggal' then i in ('karyawan','rakHist','toko','settings')
    when k = 'cases' then d->>'jenis' = 'PENDING'
    when k = 'dendaMeta' then exists (select 1 from public.denda_hitung h
      where h.company_id = public.raksa_usaha_saya() and h.id = i and h.orang = public.nama_saya())
    else false end
$$;

create or replace function public.raksa_karyawan_bm() returns jsonb
language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(upper(trim(e.full_name)) order by e.full_name), '[]'::jsonb)
    from public.employees e
   where e.company_id = public.raksa_usaha_saya() and e.status = 'active' and public.akses_saya() is not null;
$$;

create or replace function public.simpan_modal(baris jsonb) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare n integer; c uuid := public.raksa_usaha_saya();
begin
  if coalesce(public.akses_saya(), '') not in ('OWNER','ADMIN') or c is null then
    raise exception 'Tidak berhak menyimpan harga modal';
  end if;
  insert into public.dokumen (company_id, koleksi, id, data, dihapus, tgl, diubah_oleh)
  select c, 'skuModal', r->>'id', coalesce(r->'data', '{}'::jsonb), coalesce((r->>'dihapus')::boolean, false), null, auth.uid()
  from jsonb_array_elements(baris) r where coalesce(r->>'id','') <> ''
  on conflict (company_id, koleksi, id) do update set data = excluded.data, dihapus = excluded.dihapus, diubah_oleh = excluded.diubah_oleh;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.perlu_2fa(p_company uuid default null) returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce((select m.role = 'owner' and not private.usaha_demo(m.company_id) from public.memberships m
    where m.user_id = (select auth.uid()) and m.status = 'active'
      and m.company_id = coalesce(p_company, public.raksa_usaha_saya(), public.raksa_company()) limit 1), false)
$$;

create or replace function public.aplikasi_saya(p_company uuid default null) returns text[]
language sql stable security definer set search_path to '' as $$
  with h as (
    select m.role, case when m.role = 'owner' then null
      else private.member_perms(m.company_id, m.role, m.custom_role_id, m.role_ids) end as p
    from public.memberships m
    where m.company_id = coalesce(p_company, public.raksa_usaha_saya(), public.raksa_company())
      and m.user_id = (select auth.uid()) and m.status = 'active'
    limit 1)
  select case when h.role = 'owner' then array['seller','payroll','raksa','invoice']
    else array_remove(array[
      case when h.p && array['seller_laporan','seller_input','seller_pengaturan'] then 'seller' end,
      case when h.p && array['karyawan','gaji','absensi','payroll','payroll_approve','kasbon','laporan'] then 'payroll' end,
      case when h.p && array['raksa_lihat','raksa_input','raksa_pengaturan'] then 'raksa' end,
      case when h.p && array['invoice_lihat','invoice_input','invoice_pengaturan'] then 'invoice' end], null) end
  from h
$$;

-- ---------- Katalog ↔ Raksa (per usaha)
create or replace function private.kat_raksa_sku(c uuid, p_id text, p_data jsonb, p_hapus boolean) returns void
language plpgsql security definer set search_path to '' as $$
declare v_id uuid; v_lama jsonb; gb text;
begin
  select to_jsonb(s) into v_lama from public.kat_sku s where s.company_id = c and s.kode = p_id;
  insert into public.kat_sku as s (company_id, kode, jenis, nama, foto, rak, harga_jual, aktif, sumber)
  values (c, p_id, case when p_data->>'tipe' = 'GUDANG_BESAR' then 'gudang_besar' else 'gudang' end,
          nullif(p_data->>'nama',''), nullif(p_data->>'foto',''), nullif(p_data->>'rak',''),
          private.angka(p_data->>'jual'), coalesce((p_data->>'aktif')::boolean, true) and not coalesce(p_hapus,false), '{raksa}')
  on conflict (company_id, kode) do update set
    jenis = excluded.jenis, nama = coalesce(excluded.nama, s.nama), foto = excluded.foto, rak = excluded.rak,
    harga_jual = coalesce(excluded.harga_jual, s.harga_jual), aktif = excluded.aktif,
    sumber = (select array_agg(distinct x) from unnest(s.sumber || '{raksa}'::text[]) x), diubah = now()
  where (s.jenis, s.nama, s.foto, s.rak, s.harga_jual, s.aktif) is distinct from
        (excluded.jenis, coalesce(excluded.nama, s.nama), excluded.foto, excluded.rak, coalesce(excluded.harga_jual, s.harga_jual), excluded.aktif)
     or not ('raksa' = any(s.sumber))
  returning s.id into v_id;
  if v_id is null then return; end if;
  if v_lama is not null then
    insert into public.kat_log(company_id, tabel, kunci, aksi, sebelum, sesudah, sumber, oleh)
    select c, 'kat_sku', p_id, 'ubah', v_lama, to_jsonb(s), 'raksa', auth.uid() from public.kat_sku s where s.id = v_id;
  end if;
  if p_data->>'tipe' = 'GUDANG_BESAR' and nullif(p_data->>'untuk','') is not null then
    update public.kat_sku set untuk_id = (select id from public.kat_sku where company_id = c and kode = p_data->>'untuk') where id = v_id;
  end if;
  gb := nullif(p_data->>'gudangBesar','');
  if gb is not null then
    insert into public.kat_kemasan(company_id, sku_id, satuan, isi, kode_gudang_besar, sumber)
    values (c, v_id, coalesce(substring(gb from '^([0-9]+[A-Za-z]+)-'), 'GUDANG BESAR'),
            coalesce(private.angka(substring(gb from '^([0-9]+)')), 1), gb, 'raksa')
    on conflict (company_id, kode_gudang_besar) where kode_gudang_besar is not null do update set sku_id = excluded.sku_id;
  end if;
end $$;

create or replace function private.kat_raksa_modal(c uuid, p_id text, p_data jsonb) returns void
language plpgsql security definer set search_path to '' as $$
declare v_sku uuid; v_modal numeric := private.angka(p_data->>'modal'); v_akhir numeric;
begin
  if v_modal is null then return; end if;
  select id into v_sku from public.kat_sku where company_id = c and kode = p_id;
  if v_sku is null then
    insert into public.kat_sku(company_id, kode, sumber) values (c, p_id, '{raksa}') returning id into v_sku;
  end if;
  select modal into v_akhir from public.kat_modal where sku_id = v_sku and sumber = 'raksa' order by berlaku_dari desc, id desc limit 1;
  if v_akhir is distinct from v_modal then
    insert into public.kat_modal(company_id, sku_id, modal, sumber, dicatat_oleh) values (c, v_sku, v_modal, 'raksa', auth.uid());
  end if;
end $$;

create or replace function private.kat_raksa_kombinasi(c uuid, p_id text, p_data jsonb, p_hapus boolean) returns void
language plpgsql security definer set search_path to '' as $$
declare v_l uuid;
begin
  insert into public.kat_listing as l (company_id, kode, plat, harga_jual, aktif, sumber)
  values (c, p_id, 'semua', private.angka(p_data->>'harga'), not coalesce(p_hapus,false), '{raksa}')
  on conflict (company_id, kode, plat) do update set harga_jual = excluded.harga_jual, aktif = excluded.aktif,
    sumber = (select array_agg(distinct x) from unnest(l.sumber || '{raksa}'::text[]) x), diubah = now()
  returning l.id into v_l;
  delete from public.kat_komponen where listing_id = v_l and sumber = 'raksa';
  insert into public.kat_komponen(listing_id, sku_id, sku_kode, qty, sumber)
  select v_l, s.id, k.key, coalesce(private.angka(k.value #>> '{}'), 1), 'raksa'
  from jsonb_each(case when jsonb_typeof(p_data->'komponen') = 'object' then p_data->'komponen' else '{}'::jsonb end) k
  left join public.kat_sku s on s.company_id = c and s.kode = k.key
  on conflict do nothing;
end $$;

create or replace function private.kat_dorong_raksa(c uuid, p_kode text, p_patch jsonb) returns void
language plpgsql security definer set search_path to '' as $$
begin
  perform set_config('kat.dari_bm', '1', true);
  update public.dokumen set data = data || p_patch where company_id = c and koleksi = 'skus' and id = p_kode;
  perform set_config('kat.dari_bm', '0', true);
end $$;

create or replace function private.kat_trg_dokumen() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if current_setting('kat.dari_bm', true) = '1' then return null; end if;
  begin
    if new.koleksi = 'skus' then perform private.kat_raksa_sku(new.company_id, new.id, new.data, new.dihapus);
    elsif new.koleksi = 'skuModal' then if not new.dihapus then perform private.kat_raksa_modal(new.company_id, new.id, new.data); end if;
    elsif new.koleksi = 'kombinasi' then perform private.kat_raksa_kombinasi(new.company_id, new.id, new.data, new.dihapus);
    end if;
  exception when others then
    perform private.kat_catat_gagal(new.company_id, new.koleksi || ':' || new.id, 'sinkron_gagal_raksa', sqlerrm);
  end;
  return null;
end $$;

create or replace function private.kat_isi(p_company uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r record;
begin
  for r in select id, data, dihapus from public.dokumen where company_id = p_company and koleksi = 'skus' order by (data->>'tipe' = 'GUDANG_BESAR') nulls first loop
    perform private.kat_raksa_sku(p_company, r.id, r.data, r.dihapus);
  end loop;
  for r in select id, data from public.dokumen where company_id = p_company and koleksi = 'skuModal' and not dihapus loop
    perform private.kat_raksa_modal(p_company, r.id, r.data);
  end loop;
  for r in select id, data, dihapus from public.dokumen where company_id = p_company and koleksi = 'kombinasi' loop
    perform private.kat_raksa_kombinasi(p_company, r.id, r.data, r.dihapus);
  end loop;
  perform private.kat_inv_induk(p) from invoice.product_parents p where p.company_id = p_company;
  perform private.kat_inv_produk(p) from invoice.products p where p.company_id = p_company;
  perform private.kat_inv_alias(a) from invoice.supplier_aliases a where a.company_id = p_company;
  perform private.kat_inv_kemasan(k) from invoice.product_packagings k where k.company_id = p_company;
  perform private.kat_inv_layer(l) from invoice.cost_layers l where l.company_id = p_company;
  perform private.kat_seller(p_company);
  perform private.kat_hitung_cek(p_company);
  return jsonb_build_object(
    'sku', (select count(*) from public.kat_sku where company_id = p_company),
    'induk', (select count(*) from public.kat_induk where company_id = p_company),
    'listing', (select count(*) from public.kat_listing where company_id = p_company),
    'komponen', (select count(*) from public.kat_komponen k join public.kat_listing l on l.id = k.listing_id where l.company_id = p_company),
    'kode_supplier', (select count(*) from public.kat_supplier_kode where company_id = p_company),
    'kemasan', (select count(*) from public.kat_kemasan where company_id = p_company),
    'modal', (select count(*) from public.kat_modal where company_id = p_company),
    'cek', (select count(*) from public.kat_cek where company_id = p_company and status = 'baru'));
end $$;

create or replace function private.raksa_sku_dari_invoice() returns trigger
language plpgsql security definer set search_path to '' as $$
declare k text := upper(trim(new.sku)); nm text; c uuid := new.company_id;
begin
  if c is null or new.pending or k = '' then return null; end if;
  if tg_op = 'UPDATE' and not coalesce(old.pending, false) then return null; end if;
  begin
    if exists (select 1 from public.dokumen where company_id = c and koleksi = 'skus' and id = k) then return null; end if;
    select coalesce(nullif(trim(new.name), ''), nullif(trim(concat_ws(' ', pp.name, new.size)), '')) into nm
      from invoice.product_parents pp where pp.id = new.parent_id;
    nm := coalesce(nm, nullif(trim(new.name), ''), k);
    insert into public.dokumen(company_id, koleksi, id, data, dihapus) values (c, 'skus', k,
      jsonb_build_object('sku', k, 'nama', nm, 'jual', 0, 'modal', 0, 'rak', '', 'aktif', true, 'sumber', 'invoice'), false)
      on conflict do nothing;
    update public.kat_cek set status = 'selesai', diselesaikan = now()
      where company_id = c and kode = k and jenis = 'hanya_di_invoice' and status = 'baru';
  exception when others then
    perform private.kat_catat_gagal(new.company_id, 'raksa_sku:' || k, 'raksa_sku_dari_invoice', sqlerrm);
  end;
  return null;
end $$;

create or replace function public.kat_tambah_sku(p_company uuid, p_kode text, p_nama text, p_rak text default null, p_harga_jual numeric default null, p_foto text default null) returns uuid
language plpgsql security definer set search_path to '' as $$
declare v uuid; v_kode text := upper(trim(p_kode));
begin
  if not private.punya_hak(p_company, 'bm.katalog.tambah') then raise exception 'Anda tidak punya akses menambah SKU'; end if;
  if v_kode !~ '^[A-Z0-9()._/+-]{2,80}$' then raise exception 'Kode SKU hanya huruf besar, angka, dan tanda ( ) . - _ / +'; end if;
  if exists (select 1 from public.kat_sku where company_id = p_company and upper(kode) = v_kode) then raise exception 'Kode SKU % sudah ada', v_kode; end if;
  insert into public.kat_sku(company_id, kode, nama, rak, harga_jual, foto, sumber, diubah_oleh)
  values (p_company, v_kode, nullif(trim(p_nama),''), nullif(upper(trim(p_rak)),''), p_harga_jual, nullif(trim(p_foto),''),
          '{business_manager,raksa}'::text[], auth.uid())
  returning id into v;
  insert into public.kat_log(company_id, tabel, kunci, aksi, sesudah, sumber, oleh)
  select p_company, 'kat_sku', v_kode, 'tambah', to_jsonb(s), 'business_manager', auth.uid() from public.kat_sku s where s.id = v;
  if not exists (select 1 from public.dokumen where company_id = p_company and koleksi = 'skus' and id = v_kode) then
    perform set_config('kat.dari_bm', '1', true);
    insert into public.dokumen(company_id, koleksi, id, data) values (p_company, 'skus', v_kode, jsonb_build_object('sku', v_kode, 'nama', coalesce(nullif(trim(p_nama),''), v_kode),
      'rak', coalesce(nullif(upper(trim(p_rak)),''), ''), 'jual', coalesce(p_harga_jual, 0), 'foto', coalesce(nullif(trim(p_foto),''), ''), 'aktif', true));
    perform set_config('kat.dari_bm', '0', true);
  end if;
  return v;
end $$;

create or replace function public.kat_ubah_sku(p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare s public.kat_sku; baru public.kat_sku; raksa jsonb := '{}'; k text;
begin
  select * into s from public.kat_sku where id = p_id;
  if s.id is null then raise exception 'SKU tidak ditemukan'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k = 'harga_jual' then raise exception 'Harga jual mengikuti harga di pesanan (per toko) di Raksa, tidak diubah dari katalog'; end if;
    if k in ('nama','ukuran','warna','kategori') and not private.punya_hak(s.company_id, 'bm.katalog.ubah') then raise exception 'Anda tidak punya akses mengubah data SKU'; end if;
    if k in ('foto','rak') and not private.punya_hak(s.company_id, 'bm.katalog.foto_rak') then raise exception 'Anda tidak punya akses mengubah foto & rak'; end if;
    if k = 'aktif' and not private.punya_hak(s.company_id, 'bm.katalog.nonaktif') then raise exception 'Anda tidak punya akses menonaktifkan SKU'; end if;
    if k not in ('nama','ukuran','warna','kategori','foto','rak','aktif') then raise exception 'Kolom % tidak bisa diubah di sini', k; end if;
  end loop;
  update public.kat_sku set
    nama = case when p_patch ? 'nama' then nullif(trim(p_patch->>'nama'),'') else nama end,
    ukuran = case when p_patch ? 'ukuran' then nullif(trim(p_patch->>'ukuran'),'') else ukuran end,
    warna = case when p_patch ? 'warna' then nullif(trim(p_patch->>'warna'),'') else warna end,
    kategori = case when p_patch ? 'kategori' then nullif(trim(p_patch->>'kategori'),'') else kategori end,
    foto = case when p_patch ? 'foto' then nullif(trim(p_patch->>'foto'),'') else foto end,
    rak = case when p_patch ? 'rak' then nullif(upper(trim(p_patch->>'rak')),'') else rak end,
    aktif = case when p_patch ? 'aktif' then (p_patch->>'aktif')::boolean else aktif end,
    diubah = now(), diubah_oleh = auth.uid()
  where id = p_id returning * into baru;
  insert into public.kat_log(company_id, tabel, kunci, aksi, sebelum, sesudah, sumber, oleh)
  values (s.company_id, 'kat_sku', s.kode, 'ubah', to_jsonb(s), to_jsonb(baru), 'business_manager', auth.uid());
  if 'raksa' = any(s.sumber) then
    if p_patch ? 'nama' then raksa := raksa || jsonb_build_object('nama', coalesce(baru.nama, baru.kode)); end if;
    if p_patch ? 'foto' then raksa := raksa || jsonb_build_object('foto', coalesce(baru.foto, '')); end if;
    if p_patch ? 'rak' then raksa := raksa || jsonb_build_object('rak', coalesce(baru.rak, '')); end if;
    if p_patch ? 'aktif' then raksa := raksa || jsonb_build_object('aktif', baru.aktif); end if;
    if raksa <> '{}' then perform private.kat_dorong_raksa(s.company_id, s.kode, raksa); end if;
  end if;
  return to_jsonb(baru);
end $$;

create or replace function public.kat_impor(p_company uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r jsonb; n int := 0; v_kode text; s public.kat_sku; baru public.kat_sku; patch jsonb; raksa jsonb; v_gb text;
  c_baru int := 0; c_ubah int := 0; c_sama int := 0; err jsonb := '[]';
  h_tambah boolean := private.punya_hak(p_company, 'bm.katalog.tambah'); h_ubah boolean := private.punya_hak(p_company, 'bm.katalog.ubah');
  h_foto boolean := private.punya_hak(p_company, 'bm.katalog.foto_rak');
  h_non boolean := private.punya_hak(p_company, 'bm.katalog.nonaktif'); h_impor boolean := private.punya_hak(p_company, 'bm.katalog.impor');
  t text;
begin
  if not h_impor then raise exception 'Anda tidak punya akses impor katalog'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'Maksimal 2.000 baris per kiriman'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    begin
      v_kode := upper(trim(r->>'kode'));
      if v_kode is null or v_kode = '' then continue; end if;
      if v_kode !~ '^[A-Z0-9()._/+,-]{2,80}$' then raise exception 'Kode SKU tidak valid'; end if;
      v_gb := nullif(upper(trim(r->>'sku_gudang')),'');
      s := null;
      select * into s from public.kat_sku where company_id = p_company and kode = v_kode;
      patch := '{}';
      foreach t in array array['nama','rak','foto','kategori','ukuran'] loop
        if nullif(trim(r->>t),'') is not null and (to_jsonb(s)->>t) is distinct from (case when t = 'rak' then upper(trim(r->>t)) else trim(r->>t) end) then
          patch := patch || jsonb_build_object(t, case when t = 'rak' then upper(trim(r->>t)) else trim(r->>t) end);
        end if;
      end loop;
      if nullif(trim(r->>'aktif'),'') is not null then
        if (lower(trim(r->>'aktif')) in ('ya','y','1','true','aktif')) is distinct from s.aktif then patch := patch || jsonb_build_object('aktif', lower(trim(r->>'aktif')) in ('ya','y','1','true','aktif')); end if;
      end if;
      if (patch ?| array['nama','kategori','ukuran']) and s.id is not null and not h_ubah then raise exception 'Tidak punya akses ubah nama/kategori/ukuran'; end if;
      if (patch ?| array['rak','foto']) and not h_foto then raise exception 'Tidak punya akses ubah rak & foto'; end if;
      if patch ? 'aktif' and s.id is not null and not h_non then raise exception 'Tidak punya akses menonaktifkan SKU'; end if;

      if s.id is null then
        if not h_tambah then raise exception 'Tidak punya akses menambah SKU baru'; end if;
        insert into public.kat_sku(company_id, kode, nama, rak, foto, kategori, ukuran, aktif, sumber, diubah_oleh)
        values (p_company, v_kode, patch->>'nama', patch->>'rak', patch->>'foto', patch->>'kategori', patch->>'ukuran',
                coalesce((patch->>'aktif')::boolean, true), '{impor,raksa}'::text[], auth.uid())
        returning * into baru;
        insert into public.kat_log(company_id, tabel, kunci, aksi, sesudah, sumber, oleh) values (p_company, 'kat_sku', v_kode, 'tambah', to_jsonb(baru), 'impor', auth.uid());
        c_baru := c_baru + 1;
        if not exists (select 1 from public.dokumen where company_id = p_company and koleksi = 'skus' and id = v_kode) then
          perform set_config('kat.dari_bm', '1', true);
          insert into public.dokumen(company_id, koleksi, id, data) values (p_company, 'skus', v_kode, jsonb_build_object('sku', v_kode, 'nama', coalesce(baru.nama, v_kode),
            'rak', coalesce(baru.rak, ''), 'jual', 0, 'foto', coalesce(baru.foto, ''), 'aktif', baru.aktif));
          perform set_config('kat.dari_bm', '0', true);
        end if;
        s := baru;
      elsif patch <> '{}' then
        update public.kat_sku set
          nama = coalesce(patch->>'nama', nama), rak = coalesce(patch->>'rak', rak), foto = coalesce(patch->>'foto', foto),
          kategori = coalesce(patch->>'kategori', kategori), ukuran = coalesce(patch->>'ukuran', ukuran),
          aktif = coalesce((patch->>'aktif')::boolean, aktif), diubah = now(), diubah_oleh = auth.uid()
        where id = s.id returning * into baru;
        insert into public.kat_log(company_id, tabel, kunci, aksi, sebelum, sesudah, sumber, oleh) values (p_company, 'kat_sku', v_kode, 'ubah', to_jsonb(s), to_jsonb(baru), 'impor', auth.uid());
        if 'raksa' = any(s.sumber) then
          raksa := '{}';
          if patch ? 'nama' then raksa := raksa || jsonb_build_object('nama', baru.nama); end if;
          if patch ? 'rak' then raksa := raksa || jsonb_build_object('rak', baru.rak); end if;
          if patch ? 'foto' then raksa := raksa || jsonb_build_object('foto', baru.foto); end if;
          if patch ? 'aktif' then raksa := raksa || jsonb_build_object('aktif', baru.aktif); end if;
          if raksa <> '{}' then perform private.kat_dorong_raksa(p_company, v_kode, raksa); end if;
        end if;
        c_ubah := c_ubah + 1;
      else
        c_sama := c_sama + 1;
      end if;

      if v_gb is not null and v_gb is distinct from (select k.kode_gudang_besar from public.kat_kemasan k where k.sku_id = s.id and k.kode_gudang_besar is not null limit 1) then
        if not h_ubah then raise exception 'Tidak punya akses ubah SKU Gudang'; end if;
        update public.dokumen set data = data || jsonb_build_object('gudangBesar', v_gb) where company_id = p_company and koleksi = 'skus' and id = v_kode;
        insert into public.dokumen(company_id, koleksi, id, data) values (p_company, 'skus', v_gb, jsonb_build_object('sku', v_gb, 'nama', v_kode || ' (stok Gudang Besar)',
          'rak', 'GUDANG BESAR', 'aktif', true, 'tipe', 'GUDANG_BESAR', 'untuk', v_kode))
        on conflict (company_id, koleksi, id) do nothing;
      end if;
    exception when others then
      err := err || jsonb_build_object('baris', n, 'kode', r->>'kode', 'pesan', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('baru', c_baru, 'ubah', c_ubah, 'sama', c_sama, 'modal', 0, 'error', err);
end $$;

-- ---------- paket, toko, pesanan per usaha
create or replace function private.raksa_paket_sah(p_company uuid, p_dari date, p_sampai date)
returns table(tgl date, badan text, n numeric)
language sql stable security definer set search_path to '' as $$
  with o as (
    select ((d.data->>'dikirim')::timestamptz at time zone 'Asia/Jakarta')::date tgl,
           lower(coalesce(d.data->>'marketplace', 'shopee')) || '|' ||
           case when upper(trim(split_part(d.data->>'toko', ' - ', 1))) = 'DG' then 'Dunia Gelang'
                else initcap(lower(trim(split_part(d.data->>'toko', ' - ', 1)))) end outlet
      from public.dokumen d
     where d.company_id = p_company and d.koleksi = 'orders' and not coalesce(d.dihapus, false)
       and nullif(d.data->>'dikirim', '') is not null
       and ((d.data->>'dikirim')::timestamptz at time zone 'Asia/Jakarta')::date between p_dari and p_sampai
       and nullif(d.data->>'batal', '') is null
       and coalesce(d.data->>'status', '') not in ('DIBATALKAN', 'PENGEMBALIAN')
       and not exists (select 1 from public.dokumen c where c.company_id = p_company and c.koleksi = 'cases' and not coalesce(c.dihapus, false)
                        and c.data->>'jenis' = 'RETUR' and c.data->>'nomor' = d.id)
  )
  select o.tgl, k.id, count(*)::numeric from o
    left join public.kelompok_usaha k on k.company_id = p_company and k.aktif and k.outlets @> jsonb_build_array(o.outlet)
   group by 1, 2
$$;

create or replace function public.paket_per_badan(p_company uuid, p_dari date, p_sampai date) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare r jsonb;
begin
  if not (private.is_member(p_company) or private.is_platform_admin()) then raise exception 'Tidak punya akses'; end if;
  select coalesce(jsonb_object_agg(b, n), '{}'::jsonb) into r
    from (select coalesce(s.badan, '') b, sum(s.n) n from private.raksa_paket_sah(p_company, p_dari, p_sampai) s group by 1) x;
  return r;
end $$;

create or replace function public.daftar_toko_dikenal(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare r jsonb;
begin
  if not (private.is_member(p_company) or private.is_platform_admin()) then raise exception 'Tidak punya akses'; end if;
  with t as (
    select jsonb_array_elements_text(outlets) o, 'badan' src from public.kelompok_usaha where company_id = p_company and aktif
    union all
    select distinct lower(coalesce(d.data->>'marketplace', 'shopee')) || '|' ||
           case when upper(trim(split_part(d.data->>'toko', ' - ', 1))) = 'DG' then 'Dunia Gelang'
                else initcap(lower(trim(split_part(d.data->>'toko', ' - ', 1)))) end, 'raksa'
      from public.dokumen d where d.company_id = p_company and d.koleksi = 'orders' and not coalesce(d.dihapus, false)
    union all
    select distinct coalesce(nullif(x->>'plat', ''), 'shopee') || '|' || coalesce(x->>'toko', ''), 'seller'
      from public.buku b, jsonb_array_elements(case when jsonb_typeof(b.data->'order') = 'array' then b.data->'order' else '[]'::jsonb end) x
     where b.company_id = p_company
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', o, 'sumber', srcs) order by o), '[]'::jsonb) into r
    from (select o, jsonb_agg(distinct src) srcs from t where o is not null and o <> '' group by o) s;
  return r;
end $$;

create or replace function public.seller_pesanan_raksa(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare r jsonb;
begin
  if not (private.is_member(p_company) or private.is_platform_admin()) then
    raise exception 'Tidak punya akses' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(
      o.data->>'nomor',
      to_char((nullif(o.data->>'dibuat','')::timestamptz at time zone 'Asia/Jakarta'), 'YYYY-MM-DD'),
      to_char((coalesce(nullif(o.data->>'selesai',''), nullif(o.data->>'dikirim',''), nullif(o.data->>'dibuat',''))::timestamptz at time zone 'Asia/Jakarta'), 'YYYY-MM-DD'),
      o.data->>'status', o.data->>'toko', o.data->>'marketplace',
      l->>'sku', (l->>'qty')::numeric, (l->>'harga')::numeric, l->>'variasi')), '[]'::jsonb)
  into r
  from public.dokumen o, jsonb_array_elements(coalesce(o.data->'lines','[]'::jsonb)) l
  where o.company_id = p_company and o.koleksi = 'orders' and not coalesce(o.dihapus, false);
  return r;
end $$;

create or replace function public.kat_detail(p_id uuid) returns jsonb
language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'sku', to_jsonb(s) || jsonb_build_object('harga_jual_raksa', s.harga_jual),
    'induk', (select to_jsonb(i) from public.kat_induk i where i.id = s.induk_id),
    'kemasan', coalesce((select jsonb_agg(to_jsonb(k)) from public.kat_kemasan k where k.sku_id = s.id or (k.induk_id = s.induk_id and k.induk_id is not null)), '[]'),
    'supplier', coalesce((select jsonb_agg(to_jsonb(k) order by k.supplier_nama) from public.kat_supplier_kode k where k.sku_id = s.id or (k.induk_id = s.induk_id and k.sku_id is null and k.induk_id is not null)), '[]'),
    'modal_seller', coalesce((select jsonb_agg(jsonb_build_object('plat', l.plat, 'kode', l.kode, 'modal', m.modal, 'tgl', m.berlaku_dari) order by l.plat)
        from public.kat_listing l join lateral (select k.modal, k.berlaku_dari from public.kat_modal k where k.listing_id = l.id and k.sumber = 'seller' order by k.berlaku_dari desc, k.id desc limit 1) m on true
        where l.company_id = s.company_id and l.kode = s.kode), '[]'),
    'hpp_invoice', coalesce((select jsonb_agg(to_jsonb(m) order by m.berlaku_dari desc) from (select modal, berlaku_dari from public.kat_modal m where m.sku_id = s.id and m.sumber = 'invoice' order by m.berlaku_dari desc limit 10) m), '[]'),
    'modal_raksa', (select m.modal from public.kat_modal m where m.sku_id = s.id and m.sumber = 'raksa' order by m.berlaku_dari desc, m.id desc limit 1),
    'jual_toko', coalesce((
        select jsonb_agg(jsonb_build_object('toko', toko, 'median', median, 'n', n) order by toko) from (
          select o.data->>'toko' toko, percentile_cont(0.5) within group (order by (ln->>'harga')::numeric) median, count(*) n
          from public.dokumen o, jsonb_array_elements(o.data->'lines') ln
          where o.company_id = s.company_id and o.koleksi = 'orders' and not o.dihapus and ln->>'sku' = s.kode and private.angka(ln->>'harga') > 0
            and o.tgl >= now() - interval '30 days'
          group by 1) t), '[]'),
    'dipakai', coalesce((select jsonb_agg(jsonb_build_object('listing', l.kode, 'plat', l.plat, 'qty', k.qty, 'sumber', k.sumber)) from public.kat_komponen k join public.kat_listing l on l.id = k.listing_id where k.sku_id = s.id), '[]'),
    'log', coalesce((select jsonb_agg(to_jsonb(g) order by g.waktu desc) from (select * from public.kat_log g where g.company_id = s.company_id and g.kunci = s.kode order by g.waktu desc limit 20) g), '[]')
  ) from public.kat_sku s where s.id = p_id
$$;
