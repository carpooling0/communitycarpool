-- ═════════════════════════════════════════════════════════════════════════════
-- Cron jobs added by the security hardening work
--
--   match-sweep                every 10 min   find-matches {"sweep": true}
--   usage-alerts-hourly        hourly         usage-alerts
--   sync-ses-suppressions      daily 01:30    sync-ses-suppressions
--
-- Privileged functions now require the service-role key, so these jobs authenticate with it.
-- The project URL and key are read from the existing process-deletions-daily job, which
-- already carries them, so nothing needs to be typed or pasted. Safe to run more than once.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare
  src text;
  base_url text;
  svc_key text;
  j record;
begin
  select command into src from cron.job where jobname = 'process-deletions-daily';
  if src is null then raise exception 'process-deletions-daily job not found'; end if;
  base_url := substring(src from 'https://[a-z0-9]+\.supabase\.co');
  svc_key  := substring(src from 'Bearer (eyJ[A-Za-z0-9._-]+)');
  if base_url is null or svc_key is null then raise exception 'could not read url/key from process-deletions-daily'; end if;

  for j in
    select * from (values
      ('match-sweep',           '*/10 * * * *', '/functions/v1/find-matches',          '{"sweep": true}'),
      ('usage-alerts-hourly',   '7 * * * *',    '/functions/v1/usage-alerts',          '{}'),
      ('sync-ses-suppressions', '30 1 * * *',   '/functions/v1/sync-ses-suppressions', '{}')
    ) as t(jobname, schedule, path, body)
  loop
    perform cron.unschedule(jobid) from cron.job where jobname = j.jobname;
    perform cron.schedule(
      j.jobname, j.schedule,
      format($c$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := %L::jsonb, timeout_milliseconds := 60000)$c$,
             base_url || j.path, 'Bearer ' || svc_key, j.body)
    );
  end loop;
end $$;

select jobname, schedule, active from cron.job where jobname in ('match-sweep','usage-alerts-hourly','sync-ses-suppressions') order by jobname;
