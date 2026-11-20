-- Raksa per usaha (tahap B): kunci utama menjadi (usaha, koleksi, id). Tidak ada baris yang dihapus.
alter table public.dokumen drop constraint dokumen_pkey;
alter table public.dokumen add constraint dokumen_pkey primary key using index dokumen_usaha_kunci;
alter table public.denda_hitung drop constraint denda_hitung_pkey;
alter table public.denda_hitung add constraint denda_hitung_pkey primary key using index denda_hitung_usaha_kunci;
