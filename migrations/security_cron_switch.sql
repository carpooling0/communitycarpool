-- ═════════════════════════════════════════════════════════════════════════════
-- Point the existing cron jobs at the service-role key
--
-- find-matches, batch-send-emails, process-deletions, expire-journeys, send-interest-reminders
-- and send-carpooling-checkup now refuse the public (anon) key. Three existing jobs were
-- authenticating with it:
--   batch-emails                    Authorization: Bearer <anon>
--   expire-journeys                 Authorization: Bearer <anon>
--   send-interest-reminders-daily   apikey: <anon>      (no Authorization header at all)
--
-- RUN THIS BEFORE deploying the guarded functions. It is safe against the OLD functions too,
-- because a service-role key is also a valid Supabase JWT. The key is copied from the
-- process-deletions-daily job, which already uses it, so nothing is typed or printed.
-- Safe to run more than once.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare
  svc_key text;
  r record;
  n integer := 0;
begin
  select substring(command from 'Bearer (eyJ[A-Za-z0-9._-]+)') into svc_key
    from cron.job where jobname = 'process-deletions-daily';
  if svc_key is null then raise exception 'service key not found in process-deletions-daily'; end if;

  for r in select jobid, jobname, command from cron.job
            where jobname in ('batch-emails', 'expire-journeys', 'send-interest-reminders-daily') loop
    perform cron.alter_job(r.jobid, command :=
      regexp_replace(
        regexp_replace(r.command, '"apikey":"eyJ[A-Za-z0-9._-]+"', '"Authorization":"Bearer ' || svc_key || '"', 'g'),
        'Bearer eyJ[A-Za-z0-9._-]+', 'Bearer ' || svc_key, 'g'));
    n := n + 1;
  end loop;
  if n <> 3 then raise exception 'expected to update 3 jobs, updated %', n; end if;
end $$;

-- Verify: every job that calls a protected function must now carry the service key
select jobname,
       case when command like '%"Authorization":"Bearer eyJ%' or command like '%''Authorization'', ''Bearer eyJ%' or command like '%"Authorization": "Bearer eyJ%'
            then 'has Authorization header' else 'CHECK' end as auth_header
from cron.job
where jobname in ('batch-emails','expire-journeys','send-interest-reminders-daily','process-deletions-daily')
order by jobname;
