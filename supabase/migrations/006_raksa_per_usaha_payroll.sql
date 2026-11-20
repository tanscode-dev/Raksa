-- Raksa per usaha (tahap 2b): fungsi Payroll/Karyawan ↔ Raksa dibuat per usaha.
-- Dibuat dengan mengganti potongan teks yang pasti pada definisi yang sedang berjalan
-- (setiap potongan wajib ditemukan; bila tidak, migrasi dibatalkan).
do $mig$
declare
  f record; src text; ganti text[]; i int;
  daftar jsonb := jsonb_build_object(
    'public.isi_borongan_raksa(uuid,date,date,uuid,uuid)', jsonb_build_array(
      jsonb_build_array(E'  if p_company is distinct from public.raksa_company() then return jsonb_build_object(''paket'', 0, ''hari'', 0); end if;\n', '')),
    'public.koreksi_borongan_raksa(uuid,uuid,uuid,uuid)', jsonb_build_array(
      jsonb_build_array(E'  if p_company is distinct from public.raksa_company() then return ''{}''::jsonb; end if;\n', '')),
    'public.payroll_denda_raksa(uuid,date,date,text,uuid)', jsonb_build_array(
      jsonb_build_array(E'  if p_company is distinct from public.raksa_company() then return jsonb_build_object(''karyawan'', ''[]''::jsonb, ''tanpa_karyawan'', ''[]''::jsonb); end if;\n', ''),
      jsonb_build_array(E'     where not coalesce(h.dihapus, false)\n       and nullif(h.data->>''tanggal'', '''') is not null',
                        E'     where h.company_id = p_company and not coalesce(h.dihapus, false)\n       and nullif(h.data->>''tanggal'', '''') is not null')),
    'public.payroll_nama_raksa(uuid)', jsonb_build_array(
      jsonb_build_array(E'     where p_company = public.raksa_company() and not coalesce(h.dihapus, false)\n       and coalesce(trim(h.orang)',
                        E'     where h.company_id = p_company and not coalesce(h.dihapus, false)\n       and coalesce(trim(h.orang)'),
      jsonb_build_array('where p_company = public.raksa_company() and d.koleksi = ''_tunggal''', 'where d.company_id = p_company and d.koleksi = ''_tunggal'''),
      jsonb_build_array('where p_company = public.raksa_company() and not coalesce(h.dihapus, false) and h.data->>''status'' = ''AKTIF''',
                        'where h.company_id = p_company and not coalesce(h.dihapus, false) and h.data->>''status'' = ''AKTIF''')),
    'public.payroll_tandai_denda_raksa(uuid,uuid)', jsonb_build_array(
      jsonb_build_array('if per is null or p_company is distinct from public.raksa_company() then return 0; end if;', 'if per is null then return 0; end if;'),
      jsonb_build_array(E'insert into public.dokumen (koleksi, id, data) values (''dendaMeta'', x->>''id'', meta)\n        on conflict (koleksi, id)',
                        E'insert into public.dokumen (company_id, koleksi, id, data) values (p_company, ''dendaMeta'', x->>''id'', meta)\n        on conflict (company_id, koleksi, id)'),
      jsonb_build_array('update public.denda_hitung h set data = h.data || meta where h.id = x->>''id'';',
                        'update public.denda_hitung h set data = h.data || meta where h.company_id = p_company and h.id = x->>''id'';'),
      jsonb_build_array(E'insert into public.dokumen (koleksi, id, data) values (''dendaMeta'', kp.denda_id, meta)\n    on conflict (koleksi, id)',
                        E'insert into public.dokumen (company_id, koleksi, id, data) values (p_company, ''dendaMeta'', kp.denda_id, meta)\n    on conflict (company_id, koleksi, id)'),
      jsonb_build_array('update public.denda_hitung h set data = h.data || meta where h.id = kp.denda_id',
                        'update public.denda_hitung h set data = h.data || meta where h.company_id = p_company and h.id = kp.denda_id')),
    'public.bm_karyawan(uuid)', jsonb_build_array(
      jsonb_build_array('where k.employee_id = e.id and not d.dihapus)', 'where k.employee_id = e.id and d.company_id = p_company and not d.dihapus)'),
      jsonb_build_array('from public.denda_hitung d where not d.dihapus and upper(trim(d.orang)) = k.nama)',
                        'from public.denda_hitung d where d.company_id = p_company and not d.dihapus and upper(trim(d.orang)) = k.nama)'),
      jsonb_build_array('exists (select 1 from public.raksa_nama r where upper(trim(r.nama)) = k.nama)',
                        'exists (select 1 from public.raksa_nama r join public.memberships mm on mm.user_id = r.user_id and mm.company_id = p_company and mm.status = ''active'' where upper(trim(r.nama)) = k.nama)')),
    'public.bersihkan_data()', jsonb_build_array(
      jsonb_build_array('(select 1 from public.dokumen c where c.koleksi = ''cases''', '(select 1 from public.dokumen c where c.company_id = d.company_id and c.koleksi = ''cases'''))
  );
  k text; pasangan jsonb;
begin
  for k in select jsonb_object_keys(daftar) loop
    src := pg_get_functiondef(k::regprocedure);
    for pasangan in select * from jsonb_array_elements(daftar->k) loop
      if strpos(src, pasangan->>0) = 0 then
        raise exception 'Potongan tidak ditemukan di %: %', k, left(pasangan->>0, 80);
      end if;
      src := replace(src, pasangan->>0, pasangan->>1);
    end loop;
    execute src;
  end loop;
end $mig$;
