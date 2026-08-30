-- ═════════════════════════════════════════════════════════════════════════════
-- intern-resumes storage bucket
--
-- Backs the optional CV upload on intern.html. The page uploads with the ANON
-- key to  /storage/v1/object/intern-resumes/<ts>_<filename>  and then stores the
-- /object/public/ URL in intern_applications.resume_url, so the bucket has to be
-- public and has to accept anonymous inserts.
--
-- RUN THIS ON DEV (jboohdwihsiuvyrfeftp). Prod already has the bucket.
-- Safe to run more than once.
--
-- ⚠ Read the privacy note at the bottom before running this on any new project.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. The bucket ─────────────────────────────────────────────────────────────
-- 5 MB matches the client-side check in intern.html.
-- allowed_mime_types is left NULL deliberately: the browser sends
-- `file.type || 'application/octet-stream'`, and some systems report .doc/.docx
-- inconsistently, so a strict list would reject legitimate uploads. The file
-- picker already restricts to .pdf/.doc/.docx and the size cap is enforced here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intern-resumes', 'intern-resumes', true, 5242880, null)
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ── 2. Allow anonymous uploads into this bucket only ──────────────────────────
drop policy if exists "intern resumes: anon insert" on storage.objects;
create policy "intern resumes: anon insert"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'intern-resumes');

-- Public reads are served by the bucket's `public = true` flag, so no select
-- policy is required. Updates and deletes stay closed to anon: `x-upsert: false`
-- in the client means an insert is all it ever needs.

-- ── 3. Verify ─────────────────────────────────────────────────────────────────
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'intern-resumes';

select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'intern resumes%';

-- ═════════════════════════════════════════════════════════════════════════════
-- PRIVACY NOTE — worth a decision, not a blocker for dev
--
-- A public bucket means every uploaded CV is readable by anyone who has, or can
-- guess, its URL. The object path is `<epoch-ms>_<filename>`, which is not a
-- secret. CVs carry name, contact details and work history, so this is personal
-- data sitting behind a guessable public URL.
--
-- This mirrors how prod already behaves; it is not a regression introduced here.
-- If you want it closed off, the change is to make the bucket private and have
-- the admin UI fetch a short-lived signed URL instead of storing a public one.
-- That touches intern.html, the admin view, and any existing resume_url values.
-- ═════════════════════════════════════════════════════════════════════════════
