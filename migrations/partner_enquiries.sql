-- ═════════════════════════════════════════════════════════════════════════════
-- partner_enquiries
--
-- Backs the enquiry form on partners.html AND doubles as a lightweight pipeline
-- for tracking each partner from first enquiry through to going live.
--
-- Three groups of columns:
--   1. CAPTURED BY THE FORM  — written by submit-partner-enquiry, never edited
--   2. PIPELINE              — where this partner stands, edited by the team
--   3. CONTACTS & CONTEXT    — gathered later from email conversations
--
-- Safe to run more than once. Written only by the service role;
-- RLS is on with no policies, matching every other table in this project.
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.partner_enquiries (
  id               bigserial primary key,

  -- ── 1. Captured by the form ────────────────────────────────────────────────
  created_at       timestamptz not null default now(),
  contact_name     text        not null,
  work_email       text        not null,
  organisation     text,
  org_type         text,
  message          text,
  ip_address       text,

  -- ── 2. Pipeline ────────────────────────────────────────────────────────────
  status           text        not null default 'new',
  status_note      text,
  owner            text,
  first_contacted_at timestamptz,
  next_action      text,
  next_action_due  date,
  went_live_at     date,
  updated_at       timestamptz not null default now(),

  -- ── 3. Contacts & context, gathered from email conversations ───────────────
  primary_contact_name    text,
  primary_contact_role    text,
  primary_contact_email   text,
  primary_contact_phone   text,

  secondary_contact_name  text,
  secondary_contact_role  text,
  secondary_contact_email text,
  secondary_contact_phone text,

  org_code          text,
  estimated_members integer,
  website           text,
  city              text,
  country           text,
  admin_note        text
);

-- ── Columns, for re-runs against a table created before these were added ──────
alter table public.partner_enquiries add column if not exists status_note             text;
alter table public.partner_enquiries add column if not exists owner                   text;
alter table public.partner_enquiries add column if not exists first_contacted_at      timestamptz;
alter table public.partner_enquiries add column if not exists next_action             text;
alter table public.partner_enquiries add column if not exists next_action_due         date;
alter table public.partner_enquiries add column if not exists went_live_at            date;
alter table public.partner_enquiries add column if not exists updated_at              timestamptz not null default now();
alter table public.partner_enquiries add column if not exists primary_contact_name    text;
alter table public.partner_enquiries add column if not exists primary_contact_role    text;
alter table public.partner_enquiries add column if not exists primary_contact_email   text;
alter table public.partner_enquiries add column if not exists primary_contact_phone   text;
alter table public.partner_enquiries add column if not exists secondary_contact_name  text;
alter table public.partner_enquiries add column if not exists secondary_contact_role  text;
alter table public.partner_enquiries add column if not exists secondary_contact_email text;
alter table public.partner_enquiries add column if not exists secondary_contact_phone text;
alter table public.partner_enquiries add column if not exists org_code                text;
alter table public.partner_enquiries add column if not exists estimated_members       integer;
alter table public.partner_enquiries add column if not exists website                 text;
alter table public.partner_enquiries add column if not exists city                    text;
alter table public.partner_enquiries add column if not exists country                 text;
alter table public.partner_enquiries add column if not exists admin_note              text;

-- ── Allowed values ────────────────────────────────────────────────────────────
-- Dropped first so re-running with a changed list does not fail.
alter table public.partner_enquiries drop constraint if exists partner_enquiries_status_check;
alter table public.partner_enquiries add  constraint partner_enquiries_status_check
  check (status in (
    'new',            -- just submitted, nobody has replied yet
    'contacted',      -- we have replied, waiting on them
    'in_discussion',  -- active back-and-forth
    'pilot_agreed',   -- they said yes, page not built yet
    'live',           -- page is out with their community
    'declined',       -- they said no
    'dormant'         -- went quiet, revisit later
  ));

alter table public.partner_enquiries drop constraint if exists partner_enquiries_org_type_check;
alter table public.partner_enquiries add  constraint partner_enquiries_org_type_check
  check (org_type is null or org_type in ('school', 'corporate', 'residential', 'other'));

-- ── Keep updated_at honest ────────────────────────────────────────────────────
create or replace function public.touch_partner_enquiries_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists partner_enquiries_touch_updated_at on public.partner_enquiries;
create trigger partner_enquiries_touch_updated_at
  before update on public.partner_enquiries
  for each row execute function public.touch_partner_enquiries_updated_at();

-- ── Documentation, visible in the Supabase table editor ───────────────────────
comment on table  public.partner_enquiries is
  'Partner enquiries from partners.html, plus the pipeline for tracking each one.';
comment on column public.partner_enquiries.contact_name  is 'From the form. Not necessarily the eventual primary contact.';
comment on column public.partner_enquiries.org_type      is 'From the form: school | corporate | residential | other';
comment on column public.partner_enquiries.status        is 'new | contacted | in_discussion | pilot_agreed | live | declined | dormant';
comment on column public.partner_enquiries.status_note   is 'Why it is at this status. One line.';
comment on column public.partner_enquiries.owner         is 'Who on the team is handling this enquiry.';
comment on column public.partner_enquiries.next_action   is 'The single next thing to do.';
comment on column public.partner_enquiries.org_code      is 'Soft reference to organisations.org_code once onboarded. Deliberately not a foreign key, so it can be filled in before the org row exists.';
comment on column public.partner_enquiries.estimated_members is 'Rough community size: pupils, staff or households.';
comment on column public.partner_enquiries.admin_note    is 'Running notes from email conversations.';

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists partner_enquiries_created_at_idx      on public.partner_enquiries (created_at desc);
create index if not exists partner_enquiries_status_idx          on public.partner_enquiries (status);
create index if not exists partner_enquiries_next_action_due_idx on public.partner_enquiries (next_action_due)
  where next_action_due is not null;

-- ── Access ────────────────────────────────────────────────────────────────────
alter table public.partner_enquiries enable row level security;

-- Required for tables created after 30 May 2026 (Supabase Data API grant change)
grant all on public.partner_enquiries to service_role;
grant usage, select on sequence public.partner_enquiries_id_seq to service_role;

-- ── Verify ────────────────────────────────────────────────────────────────────
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'partner_enquiries'
order by ordinal_position;
