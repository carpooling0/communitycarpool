-- ═════════════════════════════════════════════════════════════════════════════
-- mapbox_usage
--
-- Hard monthly cap on Mapbox Directions API requests. Mapbox offers no spending
-- cap, so we count every request ourselves. find-matches and submit-journey call
-- mapbox_reserve() before each Mapbox request; once the month's count reaches
-- config.mapbox_monthly_limit the function returns FALSE and the caller falls
-- back to haversine for the rest of the month. The first refusal of a month also
-- flags the row so exactly one alert email is sent.
--
-- The count is bumped atomically in a single UPDATE, so concurrent edge function
-- invocations cannot overshoot the limit.
--
-- Safe to run more than once. Written only by the service role.
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.mapbox_usage (
  month          text        primary key,              -- 'YYYY-MM', UTC
  request_count  integer     not null default 0,
  alert_sent_at  timestamptz,                          -- set when the cap was first hit
  updated_at     timestamptz not null default now()
);

create or replace function public.mapbox_reserve(p_limit integer, p_n integer default 1)
returns table (allowed boolean, used integer, first_breach boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_count integer;
  v_alert timestamptz;
begin
  insert into mapbox_usage (month) values (v_month) on conflict (month) do nothing;

  update mapbox_usage
     set request_count = request_count + p_n, updated_at = now()
   where month = v_month and request_count + p_n <= p_limit
  returning request_count into v_count;

  if found then
    return query select true, v_count, false;
    return;
  end if;

  -- Over the limit: claim the one-time alert atomically
  update mapbox_usage set alert_sent_at = now()
   where month = v_month and alert_sent_at is null
  returning alert_sent_at into v_alert;

  select request_count into v_count from mapbox_usage where month = v_month;
  return query select false, v_count, (v_alert is not null);
end;
$$;

-- ── Access ────────────────────────────────────────────────────────────────────
alter table public.mapbox_usage enable row level security;
grant all on public.mapbox_usage to service_role;
revoke all on function public.mapbox_reserve(integer, integer) from public, anon, authenticated;
grant execute on function public.mapbox_reserve(integer, integer) to service_role;

-- ── Config ────────────────────────────────────────────────────────────────────
insert into public.config (key, value, options, description) values
  ('mapbox_monthly_limit', '80000', 'integer',
   'Hard monthly cap on Mapbox Directions requests (free tier is 100,000). Once reached, distance calculations fall back to haversine until the next UTC month and one alert email goes to support_notify_email. Counter lives in the mapbox_usage table.')
on conflict (key) do nothing;

-- ── Verify ────────────────────────────────────────────────────────────────────
select key, value, options from public.config where key = 'mapbox_monthly_limit';
