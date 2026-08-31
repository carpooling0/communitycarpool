-- ═════════════════════════════════════════════════════════════════════════════
-- deletion_admin_notified_at
--
-- Supports the "warn the admin 1 day before the grace period ends" notification
-- sent by process-deletions. Stamped when that warning goes out, so the warning
-- fires exactly once per user even if the daily cron runs twice, and so a run
-- that is missed does not silently skip the warning forever.
--
-- Safe to run more than once. Run on DEV first.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.users
  add column if not exists deletion_admin_notified_at timestamptz;

comment on column public.users.deletion_admin_notified_at is
  'When the admin was warned that this account is about to be permanently deleted. Set by process-deletions one day before deletion_requested_at + data_retention_days. Null means not yet warned.';

-- Only ever queried alongside deletion_requested_at, and only for rows awaiting
-- deletion, so a partial index keeps it small.
create index if not exists users_deletion_pending_unwarned_idx
  on public.users (deletion_requested_at)
  where deletion_requested_at is not null and deletion_admin_notified_at is null;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'users'
  and column_name in ('deletion_requested_at', 'deletion_admin_notified_at');
