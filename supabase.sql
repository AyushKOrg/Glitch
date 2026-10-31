-- Run this once: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is safe to run again.

-- 1) A private storage bucket for everyone's files, max 25 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('glitch-files', 'glitch-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- 2) Each signed-in user can only touch files inside their own folder: <user id>/...
--    Layout:  <user id>/uploads/<file>    uploaded from the website
--             <user id>/generated/<file>  written by Glitch (the server does this with the service key)
drop policy if exists "glitch: read own files" on storage.objects;
create policy "glitch: read own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'glitch-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- Browsers may only upload into their own uploads/ folder, and only allowed file types.
drop policy if exists "glitch: upload to own uploads folder" on storage.objects;
create policy "glitch: upload to own uploads folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'glitch-files'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] = 'uploads'
    and lower(storage.extension(name)) in (
      'txt','md','py','js','ts','tsx','jsx','json','csv','html','css','java','c','cpp','h','cs','go','rs',
      'sql','yaml','yml','xml','log','ini','toml','sh','bat','pdf','docx','png','jpg','jpeg','gif','webp')
  );

drop policy if exists "glitch: delete own files" on storage.objects;
create policy "glitch: delete own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'glitch-files' and (storage.foldername(name))[1] = auth.uid()::text);
