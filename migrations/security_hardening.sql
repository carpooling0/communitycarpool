-- ═════════════════════════════════════════════════════════════════════════════
-- security_hardening  (October 2026 audit)
--
-- Shared plumbing for the hardening work:
--   1. rate_limits + rate_limit_hit()   generic atomic fixed-window limiter
--   2. security_events                  durable log of blocks, lockouts and abuse
--   3. verification attempt counters, deferred name/terms, matched_at
--   4. claim_match_email()              one match email per user per interval
--   5. organisations.rate_limit_exempt  every org client link skips the per-IP sign-up limits
--   6. config keys for every threshold
--   7. housekeeping (purge) cron jobs
--
-- Safe to run more than once. Written only by the service role; RLS is on with
-- no policies, matching every other table in this project.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Generic rate limiter ───────────────────────────────────────────────────
-- One row per key. Fixed window: the first hit opens a window, later hits count
-- inside it, and the first hit after the window expires starts a new one.
-- A single INSERT ... ON CONFLICT statement, so concurrent callers cannot race.
create table if not exists public.rate_limits (
  key           text        primary key,
  window_start  timestamptz not null default now(),
  count         integer     not null default 0
);

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns table (allowed boolean, hits integer, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_start timestamptz;
begin
  insert into rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds::double precision)
                        then now() else r.window_start end,
    count        = case when r.window_start < now() - make_interval(secs => p_window_seconds::double precision)
                        then 1 else r.count + 1 end
  returning r.count, r.window_start into v_count, v_start;

  return query select
    v_count <= p_max,
    v_count,
    greatest(0, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds::double precision) - now()))))::integer;
end;
$$;

-- ── 2. Security event log ─────────────────────────────────────────────────────
-- Supabase keeps function logs for a very short time. This table is the durable
-- record of anything abuse-related, kept 90 days.
create table if not exists public.security_events (
  id          bigserial   primary key,
  created_at  timestamptz not null default now(),
  event_type  text        not null,
  ip          text,
  subject     text,       -- email, submission id, function name, etc.
  detail      jsonb
);
create index if not exists security_events_created_idx on public.security_events (created_at desc);
create index if not exists security_events_type_idx    on public.security_events (event_type, created_at desc);

-- ── 3. Submissions / users columns ────────────────────────────────────────────
alter table public.submissions add column if not exists email_verification_attempts    integer not null default 0;
alter table public.submissions add column if not exists whatsapp_verification_attempts integer not null default 0;
-- Name and terms version typed on the form are held here and only copied onto an
-- EXISTING user's record once the email address is verified, so a stranger cannot
-- overwrite someone else's name by submitting a journey with their email.
-- Private secret handed only to the browser that submitted the journey. verify-pin and
-- resend-pin require it, so a stranger who knows a (sequential) submission id cannot
-- guess PINs, trigger resends or reset someone's PIN.
alter table public.submissions add column if not exists client_verify_secret     uuid;
alter table public.submissions add column if not exists submitted_name           text;
alter table public.submissions add column if not exists submitted_terms_version  text;
-- Set by find-matches when a journey has been matched. A NULL value means "still
-- to be matched" and is what the hourly sweep (matching_mode = batch) picks up.
-- Backfill ONLY when the column is first created (every existing journey has already been
-- matched). Re-running this migration later must never mark pending journeys as matched.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'submissions' and column_name = 'matched_at') then
    alter table public.submissions add column matched_at timestamptz;
    update public.submissions set matched_at = created_at;
  end if;
end $$;
create index if not exists submissions_unmatched_idx on public.submissions (created_at) where matched_at is null;

alter table public.users add column if not exists last_match_email_at timestamptz;
-- Backfill from the event log so the first run after deploy does not re-email
-- everyone who was already emailed today.
update public.users u
   set last_match_email_at = e.last_sent
  from (select lower(metadata->>'email') as em, max(created_at) as last_sent
          from public.events
         where event_type = 'match_email_sent' and metadata->>'email' is not null
         group by 1) e
 where lower(u.email) = e.em and u.last_match_email_at is null;

-- ── 4. One match email per user per interval ──────────────────────────────────
-- claim_match_email() takes a row lock on the user, so two overlapping
-- batch-send-emails runs cannot both claim the same person. If the send then
-- fails, release_match_email() puts the previous value back and nothing is lost:
-- the matches stay unsent and the next eligible run picks them up.
create or replace function public.claim_match_email(p_user_id integer, p_min_hours numeric)
returns table (claimed boolean, prev timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev timestamptz;
begin
  select last_match_email_at into v_prev from users where user_id = p_user_id for update;
  if v_prev is not null and v_prev > now() - make_interval(secs => (p_min_hours * 3600)::double precision) then
    return query select false, v_prev;
    return;
  end if;
  update users set last_match_email_at = now() where user_id = p_user_id;
  return query select true, v_prev;
end;
$$;

create or replace function public.release_match_email(p_user_id integer, p_prev timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update users set last_match_email_at = p_prev where user_id = p_user_id;
$$;

-- ── 4a. Per-side match notification ───────────────────────────────────────────
-- A match has two people. Until now it was marked "sent" once EITHER was emailed, so
-- with a longer email interval the other person's notification could be lost. These
-- record each side separately; batch-send-emails keeps a match pending until both
-- sides are done (or permanently unreachable).
alter table public.matches add column if not exists notified_a_at timestamptz;
alter table public.matches add column if not exists notified_b_at timestamptz;
update public.matches
   set notified_a_at = coalesce(notification_sent_at, now()),
       notified_b_at = coalesce(notification_sent_at, now())
 where notification_sent = true and notified_a_at is null and notified_b_at is null;

-- ── 4b. Atomic PIN attempt counter ─────────────────────────────────────────────
-- consume_pin_attempt() is called BEFORE a PIN is compared. It increments the
-- counter in one statement, so 100 parallel guesses still only get p_max
-- comparisons. Past the limit it voids the PIN, and the user must request a new
-- one (resend-pin resets the counter and is itself rate limited).
create or replace function public.consume_pin_attempt(p_submission_id integer, p_channel text, p_max integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  if p_channel = 'whatsapp' then
    update submissions set whatsapp_verification_attempts = whatsapp_verification_attempts + 1
     where submission_id = p_submission_id returning whatsapp_verification_attempts into v;
    if v > p_max then
      update submissions set whatsapp_verification_pin = null where submission_id = p_submission_id;
    end if;
  else
    update submissions set email_verification_attempts = email_verification_attempts + 1
     where submission_id = p_submission_id returning email_verification_attempts into v;
    if v > p_max then
      update submissions set email_verification_pin = null where submission_id = p_submission_id;
    end if;
  end if;
  return coalesce(v, 0);
end;
$$;

-- ── 5. Org links skip per-IP sign-up limits ───────────────────────────────────
-- Anyone arriving through an organisation's client link (?client=xxx) skips the per-IP
-- sign-up limits: offices and campuses put many real people behind one IP address.
-- The column is an opt-OUT (default true) so a single organisation can be switched back
-- to normal limits if its link is ever abused. PIN verification still applies to everyone.
alter table public.organisations add column if not exists rate_limit_exempt boolean not null default true;
alter table public.organisations alter column rate_limit_exempt set default true;
update public.organisations set rate_limit_exempt = true;

-- ── 5b. Size helpers for usage-alerts ──────────────────────────────────────────
create or replace function public.db_size_bytes() returns bigint
language sql security definer set search_path = public as $$ select pg_database_size(current_database()) $$;
create or replace function public.storage_bytes() returns bigint
language sql security definer set search_path = public, storage as $$
  select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects $$;

-- ── Access ────────────────────────────────────────────────────────────────────
alter table public.rate_limits     enable row level security;
alter table public.security_events enable row level security;
grant all on public.rate_limits     to service_role;
grant all on public.security_events to service_role;
grant usage, select on sequence public.security_events_id_seq to service_role;

revoke all on function public.db_size_bytes()   from public, anon, authenticated;
revoke all on function public.storage_bytes()   from public, anon, authenticated;
grant execute on function public.db_size_bytes() to service_role;
grant execute on function public.storage_bytes() to service_role;
revoke all on function public.rate_limit_hit(text, integer, integer)        from public, anon, authenticated;
revoke all on function public.claim_match_email(integer, numeric)          from public, anon, authenticated;
revoke all on function public.release_match_email(integer, timestamptz)    from public, anon, authenticated;
revoke all on function public.consume_pin_attempt(integer, text, integer)  from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer)     to service_role;
grant execute on function public.claim_match_email(integer, numeric)       to service_role;
grant execute on function public.release_match_email(integer, timestamptz) to service_role;
grant execute on function public.consume_pin_attempt(integer, text, integer) to service_role;

-- ── 6. Config ─────────────────────────────────────────────────────────────────
insert into public.config (key, value, options, description) values
  ('signup_max_per_ip_per_hour', '15', 'integer',
   'Journey sign-ups allowed per IP address per hour. Anyone using an organisation client link (?client=xxx) skips this, unless that organisation has rate_limit_exempt switched off. Shared networks (offices, mobile carriers) can put many real users behind one IP, so raise this if real users are blocked.'),
  ('signup_max_per_ip_per_day', '60', 'integer',
   'Journey sign-ups allowed per IP address per rolling day. Organisation client links skip this, as above.'),
  ('pin_max_emails_per_address_per_hour', '5', 'integer',
   'Verification PIN emails (first send plus resends) allowed per email address per hour. Stops the form being used to email-bomb someone.'),
  ('pin_max_emails_per_address_per_day', '12', 'integer',
   'Verification PIN emails allowed per email address per day.'),
  ('pin_max_wrong_attempts', '5', 'integer',
   'Wrong PIN entries allowed before the PIN is voided and a new one must be requested.'),
  ('deletion_request_max_per_address_per_day', '3', 'integer',
   'Deletion confirmation emails allowed per email address per day.'),
  ('admin_login_max_attempts', '5', 'integer',
   'Failed admin logins allowed per account per 15 minutes before it is temporarily locked.'),
  ('admin_session_hours', '24', 'integer',
   'How long an admin session lasts, in hours.'),
  ('mapbox_trust_haversine_ratio', '0.6', 'decimal 0-1',
   'When distance_method uses Mapbox, a candidate whose straight-line distance is under this fraction of the allowed radius is accepted on the straight-line figure without calling Mapbox. Only borderline candidates cost a Mapbox request. Lower = more Mapbox use, higher = more haversine.'),
  ('alert_match_emails_per_day', '1500', 'integer',
   'Send an alert email if more than this many match emails go out in 24 hours.'),
  ('alert_signups_per_ip_per_hour', '25', 'integer',
   'Send an alert email if one IP address creates more than this many journeys in an hour.')
on conflict (key) do nothing;

-- max_matches_per_submission is now enforced by find-matches (strongest matches win)
update public.config
   set value = '25',
       description = 'Maximum matches a journey can hold. Enforced by find-matches: when a journey is full, a new candidate only replaces its weakest unnotified match if the new match is stronger.'
 where key = 'max_matches_per_submission';

-- ── 7. Housekeeping ───────────────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'purge-security-tables';
select cron.schedule(
  'purge-security-tables', '15 3 * * *',
  $cron$
    delete from public.rate_limits     where window_start < now() - interval '2 days';
    delete from public.security_events where created_at   < now() - interval '90 days';
    delete from public.admin_sessions  where expires_at   < now() - interval '1 day';
  $cron$
);

-- ── Verify ────────────────────────────────────────────────────────────────────
select (select count(*) from public.submissions where matched_at is null) as unmatched_submissions,
       (select count(*) from public.users where last_match_email_at is not null) as users_backfilled,
       (select count(*) from public.config where key in ('signup_max_per_ip_per_hour','pin_max_wrong_attempts','mapbox_trust_haversine_ratio')) as new_config_keys;
