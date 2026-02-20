-- =============================================
-- COMMUNITY CARPOOL — COMPLETE SCHEMA BACKUP
-- Project: tbkjealpnoriwdosvmju (ap-southeast-1)
-- Generated: 2026-02-19
-- =============================================
-- To restore: run this file against a fresh Supabase project SQL editor
-- Order matters: extensions → tables → indexes → functions → data
-- =============================================

-- ── EXTENSIONS ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── ORGANISATIONS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organisations (
  org_id SERIAL PRIMARY KEY,
  org_code TEXT UNIQUE NOT NULL,
  org_name TEXT NOT NULL,
  logo_url TEXT,
  custom_message TEXT,
  allow_cross_matching BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_locations (
  location_id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organisations(org_id),
  location_name TEXT NOT NULL,
  location_latlng TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── USERS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  preferred_contact TEXT DEFAULT 'email',
  ip TEXT,
  country TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  total_submissions INTEGER DEFAULT 0,
  total_matches INTEGER DEFAULT 0,
  journey_limit INTEGER DEFAULT 10,
  match_page_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  token_created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  deactivated_at TIMESTAMPTZ,
  org_id INTEGER REFERENCES organisations(org_id)
);

-- ── SUBMISSIONS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS submissions (
  submission_id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  from_location TEXT,
  from_point GEOGRAPHY(POINT, 4326),
  from_lat FLOAT,
  from_lng FLOAT,
  to_location TEXT,
  to_point GEOGRAPHY(POINT, 4326),
  to_lat FLOAT,
  to_lng FLOAT,
  distance_pref NUMERIC DEFAULT 3.0,
  ip TEXT,
  country TEXT,
  status TEXT DEFAULT 'Active',
  journey_num INTEGER,
  distance_km NUMERIC,
  user_id INTEGER REFERENCES users(user_id),
  org_id INTEGER REFERENCES organisations(org_id),
  journey_status TEXT DEFAULT 'active',
  interest_while_inactive BOOLEAN DEFAULT false,
  interest_nudge_sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  expiry_nudge_sent_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  CONSTRAINT journey_status_check CHECK (journey_status IN (
    'active', 'inactive', 'inactive_with_interest', 'expired'
  ))
);

-- ── MATCHES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  match_id SERIAL PRIMARY KEY,
  sub_a_id INTEGER REFERENCES submissions(submission_id),
  sub_b_id INTEGER REFERENCES submissions(submission_id),
  match_strength NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notification_sent BOOLEAN DEFAULT false,       -- renamed from email_sent (migration: rename_email_sent_to_notification_sent)
  notification_sent_at TIMESTAMPTZ,
  email_batch_id UUID,
  status TEXT DEFAULT 'new',
  is_mutual_click BOOLEAN DEFAULT false,
  days_to_first_click INTEGER,
  success_reported BOOLEAN DEFAULT false,
  success_reported_at TIMESTAMPTZ,
  issue_reported BOOLEAN DEFAULT false,
  interest_a TEXT CHECK (interest_a IN ('yes', 'no')),   -- added: add_interest_columns_to_matches
  interest_b TEXT CHECK (interest_b IN ('yes', 'no')),   -- added: add_interest_columns_to_matches
  CONSTRAINT match_status_check CHECK (status IN (
    'new', 'notified', 'viewed', 'interest_expressed',
    'interest_notified', 'mutual_confirmed', 'contact_revealed', 'failed', 'expired'
  ))
);

-- Prevent duplicate matches (A-B same as B-A)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_match ON matches(
  LEAST(sub_a_id, sub_b_id),
  GREATEST(sub_a_id, sub_b_id)
);

-- ── EVENTS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_types (
  event_type TEXT PRIMARY KEY,
  description TEXT
);

INSERT INTO event_types VALUES
  ('page_visited',              'User landed on form'),
  ('form_started',              'User started typing'),
  ('form_submitted',            'User submitted journey'),
  ('form_resubmitted',          'User submitted again'),
  ('match_detected',            'Algorithm found match'),
  ('match_email_sent',          'Batch email sent'),
  ('match_email_failed',        'Email delivery failed'),
  ('match_email_opened',        'User opened match email'),
  ('matches_page_viewed',       'User visited matches webpage'),
  ('match_interest_expressed',  'User clicked Yes'),
  ('match_declined',            'User clicked No'),
  ('mutual_match_confirmed',    'Both clicked Yes'),
  ('contact_details_revealed',  'Emails revealed to both users'),
  ('journey_deactivated',       'User deactivated journey'),
  ('journey_reactivated',       'User reactivated journey'),
  ('journey_expired',           'Journey auto expired'),
  ('expiry_nudge_sent',         'Expiry nudge email sent'),
  ('interest_nudge_sent',       'Interest nudge email sent'),
  ('unsubscribed',              'User opted out'),
  ('carpooling_reported',       'User reported active carpool'),
  ('blacklisted',               'User blacklisted by admin')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS events (
  event_id SERIAL PRIMARY KEY,
  event_type TEXT REFERENCES event_types(event_type),
  user_id INTEGER REFERENCES users(user_id),
  submission_id INTEGER REFERENCES submissions(submission_id),
  match_id INTEGER REFERENCES matches(match_id),
  metadata JSONB,
  device_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── BLACKLIST & ADMIN ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blacklist (
  blacklist_id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  reason TEXT,
  blacklisted_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_actions (
  action_id SERIAL PRIMARY KEY,
  action_type TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  target_user_id INTEGER REFERENCES users(user_id),
  target_submission_id INTEGER REFERENCES submissions(submission_id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CONFIG ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  options TEXT,
  description TEXT
);

-- ── INDEXES ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_from_point          ON submissions USING GIST(from_point);
CREATE INDEX IF NOT EXISTS idx_to_point            ON submissions USING GIST(to_point);
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_token         ON users(match_page_token);
CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_org_id  ON submissions(org_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status  ON submissions(journey_status);
CREATE INDEX IF NOT EXISTS idx_matches_status      ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_batch       ON matches(email_batch_id);
CREATE INDEX IF NOT EXISTS idx_events_user_id      ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type         ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_match_id     ON events(match_id);
CREATE INDEX IF NOT EXISTS idx_org_locations_org   ON org_locations(org_id);

-- ── FUNCTIONS ─────────────────────────────────────────────────────────────────

-- Simple helper: count active journeys for a user by email
CREATE OR REPLACE FUNCTION count_user_journeys(user_email TEXT)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM submissions
  WHERE email = user_email
  AND journey_status = 'active';
$$ LANGUAGE SQL STABLE;

-- RPC: fetch submission coords as floats (avoids WKB geography parsing in JS client)
CREATE OR REPLACE FUNCTION get_submission_coords(p_id INT)
RETURNS TABLE (
  submission_id  INTEGER,
  from_location  TEXT,
  from_lat       FLOAT,
  from_lng       FLOAT,
  to_location    TEXT,
  to_lat         FLOAT,
  to_lng         FLOAT,
  distance_pref  NUMERIC,
  org_id         INTEGER,
  journey_status TEXT,
  email          TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.submission_id,
    s.from_location,
    ST_Y(s.from_point::geometry)::FLOAT AS from_lat,
    ST_X(s.from_point::geometry)::FLOAT AS from_lng,
    s.to_location,
    ST_Y(s.to_point::geometry)::FLOAT AS to_lat,
    ST_X(s.to_point::geometry)::FLOAT AS to_lng,
    s.distance_pref,
    s.org_id,
    s.journey_status,
    u.email
  FROM submissions s
  JOIN users u ON u.user_id = s.user_id
  WHERE s.submission_id = p_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- RPC: spatial match candidates within radius — returns floats (not geography WKB)
CREATE OR REPLACE FUNCTION find_nearby_users(
  user_from_lat  FLOAT,
  user_from_lng  FLOAT,
  user_to_lat    FLOAT,
  user_to_lng    FLOAT,
  radius_meters  FLOAT,
  exclude_email  TEXT,
  exclude_id     INTEGER,
  exclude_org_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
  submission_id INTEGER,
  from_location TEXT,
  from_lat      FLOAT,
  from_lng      FLOAT,
  to_location   TEXT,
  to_lat        FLOAT,
  to_lng        FLOAT,
  distance_pref NUMERIC,
  journey_num   INTEGER,
  org_id        INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.submission_id,
    s.from_location,
    ST_Y(s.from_point::geometry)::FLOAT AS from_lat,
    ST_X(s.from_point::geometry)::FLOAT AS from_lng,
    s.to_location,
    ST_Y(s.to_point::geometry)::FLOAT AS to_lat,
    ST_X(s.to_point::geometry)::FLOAT AS to_lng,
    s.distance_pref,
    s.journey_num,
    s.org_id
  FROM submissions s
  JOIN users u ON u.user_id = s.user_id
  WHERE s.journey_status = 'active'
    AND u.email != exclude_email
    AND s.submission_id != exclude_id
    AND (
      (exclude_org_id IS NULL AND s.org_id IS NULL) OR
      (exclude_org_id IS NOT NULL AND s.org_id = exclude_org_id)
    )
    AND ST_DWithin(
      s.from_point::geography,
      ST_MakePoint(user_from_lng, user_from_lat)::geography,
      radius_meters
    )
    AND ST_DWithin(
      s.to_point::geography,
      ST_MakePoint(user_to_lng, user_to_lat)::geography,
      radius_meters
    );
END;
$$ LANGUAGE plpgsql STABLE;
