-- Raksa Pending: batas ubah untuk Admin & Karyawan (Owner bebas). Dipasang di database Business Manager.
-- 1) Pending hari sebelumnya (WIB) terkunci.
-- 2) Jumlah diminta hanya bisa diubah selama MENUNGGU (belum diambilkan dari gudang).
-- 3) Hasil hitung (SELESAI/SELISIH) hanya bisa diubah 5 menit setelah dihitung
--    (server memberi kelonggaran 7 menit untuk jam perangkat yang meleset / sinyal lambat).
-- Baris yang melanggar dikembalikan ke nilai lama tanpa error, supaya antrean simpan aplikasi tidak macet.
create or replace function private.raksa_gabung_pending(lama jsonb, baru jsonb, p_now timestamptz default now())
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  hari_lama boolean;
  omap jsonb := '{}'::jsonb;
  hasil jsonb := '[]'::jsonb;
  x jsonb; o jsonb; st text; wt timestamptz; k text;
  kunci_qty text[] := array['qty','labelQty','qtyDiberikan','entries'];
begin
  hari_lama := ((lama->>'tanggal')::timestamptz at time zone 'Asia/Jakarta')::date
               < ((p_now - interval '5 minutes') at time zone 'Asia/Jakarta')::date;
  select coalesce(jsonb_object_agg(e->>'id', e), '{}'::jsonb) into omap
    from jsonb_array_elements(coalesce(lama->'items','[]'::jsonb)) e;

  for x in select e from jsonb_array_elements(coalesce(baru->'items','[]'::jsonb)) e loop
    o := omap->(x->>'id');
    if o is null then
      if not hari_lama then hasil := hasil || jsonb_build_array(x); end if;
      continue;
    end if;
    omap := omap - (x->>'id');
    st := o->>'status';
    if hari_lama or st in ('BATAL','DITEMUKAN_RAK','KONFIRMASI') then
      x := o;
    elsif st in ('SELESAI','SELISIH') then
      wt := nullif(o->>'waktuTerima','')::timestamptz;
      if wt is null or p_now > wt + interval '7 minutes' then
        x := o;
      else
        foreach k in array kunci_qty || array['waktuTerima'] loop
          x := case when o ? k then jsonb_set(x, array[k], o->k) else x - k end;
        end loop;
      end if;
    elsif st in ('DIKIRIM','KOSONG') then
      foreach k in array kunci_qty loop
        x := case when o ? k then jsonb_set(x, array[k], o->k) else x - k end;
      end loop;
    end if;
    hasil := hasil || jsonb_build_array(x);
  end loop;

  -- baris lama yang hilang dari data baru tetap disimpan
  select hasil || coalesce(jsonb_agg(v), '[]'::jsonb) into hasil from jsonb_each(omap) t(kk, v);

  baru := jsonb_set(baru, '{items}', hasil);
  foreach k in array array['jenis','tanggal','pic','dibuatOleh','dibuatPada'] loop
    baru := case when lama ? k then jsonb_set(baru, array[k], lama->k) else baru - k end;
  end loop;
  return baru;
end $$;

create or replace function private.raksa_kunci_pending()
returns trigger language plpgsql security definer set search_path = public as $$
declare ak text;
begin
  if old.koleksi <> 'cases' or coalesce(old.data->>'jenis','') <> 'PENDING' or old.dihapus then return new; end if;
  ak := public.akses_saya();
  if ak is null or ak = 'OWNER' then return new; end if;   -- robot/service & Owner tidak dibatasi
  new.data := private.raksa_gabung_pending(old.data, new.data, now());
  new.koleksi := old.koleksi;
  if ((old.data->>'tanggal')::timestamptz at time zone 'Asia/Jakarta')::date
     < ((now() - interval '5 minutes') at time zone 'Asia/Jakarta')::date then
    new.dihapus := old.dihapus;
  end if;
  return new;
end $$;

drop trigger if exists raksa_kunci_pending on public.dokumen;
create trigger raksa_kunci_pending before update on public.dokumen
  for each row when (old.koleksi = 'cases') execute function private.raksa_kunci_pending();
