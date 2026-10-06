-- Raksa 1.0 — pembersihan data otomatis (jalankan sekali di Supabase → SQL Editor)
create extension if not exists pg_cron;

-- ================================================================ pembersihan malam
create or replace function public.bersihkan_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- pesanan & riwayat status > 13 bulan yang tidak terkait kasus
  delete from public.dokumen d
   where d.koleksi in ('orders','history')
     and d.tgl < now() - interval '13 months'
     and not exists (select 1 from public.dokumen c
                      where c.koleksi = 'cases' and c.data->>'nomor' = coalesce(d.data->>'nomor', d.id));
  -- soft delete > 45 hari
  delete from public.dokumen where dihapus and diubah_pada < now() - interval '45 days';
  delete from public.denda_hitung where dihapus and diubah_pada < now() - interval '45 days';
  -- riwayat robot > 6 bulan, audit > 1 tahun
  delete from public.robot_run where mulai < now() - interval '6 months';
  delete from public.audit_log where waktu < now() - interval '1 year';
end $$;

select cron.unschedule('raksa-bersih') where exists (select 1 from cron.job where jobname = 'raksa-bersih');
select cron.schedule('raksa-bersih', '15 19 * * *', $$select public.bersihkan_data()$$);  -- 02.15 WIB

revoke execute on function public.klaim_file_robot(uuid) from anon, public;
revoke execute on function public.ambil_kunci(text, int) from anon, public;
revoke execute on function public.lepas_kunci(text) from anon, public;
revoke execute on function public.bersihkan_data() from anon, authenticated, public;
revoke execute on function public.karyawan_boleh(text, text, jsonb) from anon, public;
grant execute on function public.karyawan_boleh(text, text, jsonb) to authenticated;
grant execute on function public.klaim_file_robot(uuid) to authenticated;
grant execute on function public.ambil_kunci(text, int) to authenticated;
grant execute on function public.lepas_kunci(text) to authenticated;
revoke execute on function public.akses_saya() from anon, public;
revoke execute on function public.nama_saya() from anon, public;
grant execute on function public.akses_saya() to authenticated;
grant execute on function public.nama_saya() to authenticated;
