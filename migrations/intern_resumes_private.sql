-- ═════════════════════════════════════════════════════════════════════════════
-- intern-resumes: make the bucket private
--
-- Before: public bucket, anyone could upload (anon INSERT policy), and files were named
--         <timestamp>_<original name>, so they were guessable and world-readable.
-- After:  private bucket, no public policies. Uploads go through a one-time signed upload
--         URL issued by submit-intern-application (rate limited, random file name), and the
--         support notification email carries a 30 day signed download link.
--
-- Safe to run more than once.
-- ═════════════════════════════════════════════════════════════════════════════
update storage.buckets set public = false where id = 'intern-resumes';
drop policy if exists anon_insert_intern_resumes on storage.objects;
drop policy if exists "intern resumes: anon insert" on storage.objects;

-- Applications saved before this change hold a public URL. Store the storage path instead
-- (the old public links stop working once the bucket is private).
update public.intern_applications
   set resume_url = 'intern-resumes/' || split_part(resume_url, '/intern-resumes/', 2)
 where resume_url like 'http%/object/public/intern-resumes/%';

select id, public from storage.buckets where id = 'intern-resumes';
