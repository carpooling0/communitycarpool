-- =============================================
-- COMMUNITY CARPOOL - COMPLETE SCHEMA
-- Project: https://tbkjealpnoriwdosvmju.supabase.co
-- =============================================

-- =============================================
-- STEP 1: EXTENSIONS
-- =============================================
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================
-- STEP 2: ORGANISATIONS
-- =============================================
CREATE TABLE organisations (
  org_id SERIAL PRIMARY KEY,
  org_code TEXT UNIQUE NOT NULL,
  org_name TEXT NOT NULL,
  logo_url TEXT,
  custom_message TEXT,
  allow_cross_matching BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE org_locations (
  location_id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES organisations(org_id),
  location_name TEXT NOT NULL,
  location_latlng TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- STEP 3: USERS
-- =============================================
CREATE TABLE users (
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

-- =============================================
-- STEP 4: SUBMISSIONS
-- =============================================
CREATE TABLE submissions (
  submission_id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  from_location TEXT,
  from_point GEOGRAPHY(POINT, 4326),
  to_location TEXT,
  to_point GEOGRAPHY(POINT, 4326),
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
    'active',
    'inactive',
    'inactive_with_interest',
    'expired'
  ))
);

-- =============================================
-- STEP 5: MATCHES
-- =============================================
CREATE TABLE matches (
  match_id SERIAL PRIMARY KEY,
  sub_a_id INTEGER REFERENCES submissions(submission_id),
  sub_b_id INTEGER REFERENCES submissions(submission_id),
  match_strength NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  email_sent BOOLEAN DEFAULT false,
  email_sent_at TIMESTAMPTZ,
  email_batch_id UUID,
  status TEXT DEFAULT 'new',
  is_mutual_click BOOLEAN DEFAULT false,
  days_to_first_click INTEGER,
  success_reported BOOLEAN DEFAULT false,
  success_reported_at TIMESTAMPTZ,
  issue_reported BOOLEAN DEFAULT false,
  CONSTRAINT match_status_check CHECK (status IN (
    'new',
    'notified',
    'viewed',
    'interest_expressed',
    'interest_notified',
    'mutual_confirmed',
    'contact_revealed',
    'failed',
    'expired'
  ))
);

-- Prevent duplicate matches (A-B same as B-A)
CREATE UNIQUE INDEX idx_unique_match ON matches(
  LEAST(sub_a_id, sub_b_id),
  GREATEST(sub_a_id, sub_b_id)
);

-- =============================================
-- STEP 6: EVENTS
-- =============================================
CREATE TABLE event_types (
  event_type TEXT PRIMARY KEY,
  description TEXT
);

INSERT INTO event_types VALUES
('page_visited', 'User landed on form'),
('form_started', 'User started typing'),
('form_submitted', 'User submitted journey'),
('form_resubmitted', 'User submitted again'),
('match_detected', 'Algorithm found match'),
('match_email_sent', 'Batch email sent'),
('match_email_failed', 'Email delivery failed'),
('match_email_opened', 'User opened match email'),
('matches_page_viewed', 'User visited matches webpage'),
('match_interest_expressed', 'User clicked Yes'),
('match_declined', 'User clicked No'),
('mutual_match_confirmed', 'Both clicked Yes'),
('contact_details_revealed', 'Emails revealed to both users'),
('journey_deactivated', 'User deactivated journey'),
('journey_reactivated', 'User reactivated journey'),
('journey_expired', 'Journey auto expired'),
('expiry_nudge_sent', 'Expiry nudge email sent'),
('interest_nudge_sent', 'Interest nudge email sent'),
('unsubscribed', 'User opted out'),
('blacklisted', 'User blacklisted by admin');

CREATE TABLE events (
  event_id SERIAL PRIMARY KEY,
  event_type TEXT REFERENCES event_types(event_type),
  user_id INTEGER REFERENCES users(user_id),
  submission_id INTEGER REFERENCES submissions(submission_id),
  match_id INTEGER REFERENCES matches(match_id),
  metadata JSONB,
  device_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- STEP 7: BLACKLIST & ADMIN
-- =============================================
CREATE TABLE blacklist (
  blacklist_id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  reason TEXT,
  blacklisted_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE admin_actions (
  action_id SERIAL PRIMARY KEY,
  action_type TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  target_user_id INTEGER REFERENCES users(user_id),
  target_submission_id INTEGER REFERENCES submissions(submission_id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- STEP 8: INDEXES
-- =============================================
CREATE INDEX idx_from_point ON submissions USING GIST(from_point);
CREATE INDEX idx_to_point ON submissions USING GIST(to_point);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_token ON users(match_page_token);
CREATE INDEX idx_submissions_user_id ON submissions(user_id);
CREATE INDEX idx_submissions_org_id ON submissions(org_id);
CREATE INDEX idx_submissions_status ON submissions(journey_status);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_batch ON matches(email_batch_id);
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_match_id ON events(match_id);
CREATE INDEX idx_org_locations_org ON org_locations(org_id);

-- =============================================
-- STEP 9: HELPER FUNCTIONS
-- =============================================
CREATE OR REPLACE FUNCTION count_user_journeys(user_email TEXT)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER 
  FROM submissions 
  WHERE email = user_email
  AND journey_status = 'active';
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION find_nearby_users(
  user_from_lat FLOAT,
  user_from_lng FLOAT,
  user_to_lat FLOAT,
  user_to_lng FLOAT,
  radius_meters FLOAT,
  exclude_email TEXT,
  exclude_id INTEGER,
  exclude_org_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
  submission_id INTEGER,
  name TEXT,
  email TEXT,
  from_location TEXT,
  from_point GEOGRAPHY,
  to_location TEXT,
  to_point GEOGRAPHY,
  distance_pref NUMERIC,
  journey_num INTEGER,
  org_id INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.submission_id,
    s.name,
    s.email,
    s.from_location,
    s.from_point,
    s.to_location,
    s.to_point,
    s.distance_pref,
    s.journey_num,
    s.org_id
  FROM submissions s
  WHERE s.journey_status = 'active'
    AND s.email != exclude_email
    AND s.submission_id != exclude_id
    -- Org isolation: match within same org only
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

-- =============================================
-- STEP 10: SAMPLE DAMAC DATA
-- =============================================
INSERT INTO organisations (org_code, org_name, allow_cross_matching)
VALUES ('damac', 'DAMAC Properties', false);

INSERT INTO org_locations (org_id, location_name, location_latlng)
VALUES
  (1, 'Shatha Tower, Al Sufouh', '25.0895035,55.1530186'),
  (1, 'DAMAC Executive Heights, Barsha Heights', '25.0953478,55.1728533');

-- =============================================
-- STEP 11: CONFIG TABLE
-- =============================================
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  options TEXT,
  description TEXT
);

INSERT INTO config (key, value, options, description) VALUES

-- Email toggles
('send_confirmation_email', 'false', 'true, false',
 'Send confirmation on journey submission'),
('match_notification_enabled', 'true', 'true, false',
 'Send batch match emails'),
('expiry_nudge_enabled', 'true', 'true, false',
 'Send nudge email before journey expires'),
('interest_nudge_enabled', 'true', 'true, false',
 'Send nudge when inactive journey gets interest'),
('mutual_match_email_enabled', 'true', 'true, false',
 'Send immediate email when mutual match confirmed'),

-- Email frequency
('email_frequency', 'daily', 'daily, mwf, weekly, monthly',
 'How often to send batch emails. daily=6PM, mwf=Mon/Wed/Fri, weekly=Wednesdays, monthly=1st Wednesday'),
('email_service', 'resend', 'resend, sendgrid, ses',
 'Email provider'),
('batch_email_hour_utc', '15', NULL,
 'Hour in UTC for batch emails. 15=6PM Dubai'),

-- Numeric configs
('journey_expiry_days', '90', NULL,
 'Days before active journey auto-expires'),
('expiry_nudge_days', '7', NULL,
 'Days before expiry to send nudge email'),
('match_token_expiry_days', '60', NULL,
 'Days before match page token expires'),
('match_expiry_days', '30', NULL,
 'Days before uncontacted match marked expired'),
('interest_nudge_days', '7', NULL,
 'Days before nudge sent for inactive journey with interest'),
('max_journeys_per_user', '10', NULL,
 'Maximum active journeys per user'),

-- Distance & matching
('distance_method', 'haversine', 'haversine, mapbox',
 'Distance calculation for journey. haversine=free, mapbox=actual driving distance'),
('matching_method', 'haversine', 'haversine, hybrid',
 'Match verification. haversine=free, hybrid=Haversine filter + Mapbox verify'),
('matching_mode', 'hybrid', 'hybrid, instant, batch',
 'When to find and notify matches'),

-- WhatsApp
('whatsapp_enabled', 'false', 'true, false',
 'Show WhatsApp phone field on form'),
('contact_preference', 'email', 'email, whatsapp, both',
 'Default notification channel for match alerts');

-- =============================================
-- CONFIG DESCRIPTION UPDATES
-- =============================================
UPDATE config SET description = 'Send confirmation email when user submits a journey. true=send email, false=do not send email' WHERE key = 'send_confirmation_email';
UPDATE config SET description = 'Send batch match emails to users. true=emails will be sent on schedule, false=no match emails sent' WHERE key = 'match_notification_enabled';
UPDATE config SET description = 'Send nudge email before journey expires. true=warn user before expiry, false=let journey expire silently' WHERE key = 'expiry_nudge_enabled';
UPDATE config SET description = 'Send nudge when inactive journey receives interest. true=notify user someone is interested, false=do not notify' WHERE key = 'interest_nudge_enabled';
UPDATE config SET description = 'Send immediate email when both users confirm mutual interest. true=reveal contact details immediately, false=do not reveal' WHERE key = 'mutual_match_email_enabled';
UPDATE config SET description = 'Show WhatsApp phone number field on submission form. true=field visible, false=field hidden' WHERE key = 'whatsapp_enabled';
UPDATE config SET description = 'Distance calculation method. haversine=free straight-line estimate, mapbox=actual driving distance via API' WHERE key = 'distance_method';
UPDATE config SET description = 'Match verification method. haversine=free approximate matching, hybrid=Haversine pre-filter then Mapbox road verification' WHERE key = 'matching_method';
UPDATE config SET description = 'When matches are processed. hybrid=find matches immediately but email on schedule, instant=find and email immediately, batch=wait for scheduled run' WHERE key = 'matching_mode';
UPDATE config SET description = 'Batch email schedule. daily=every day 6PM Dubai, mwf=Monday Wednesday Friday, weekly=Wednesdays only, monthly=1st Wednesday of month' WHERE key = 'email_frequency';
UPDATE config SET description = 'Email delivery provider. resend=recommended for low volume, sendgrid=enterprise, ses=Amazon cheapest for high volume' WHERE key = 'email_service';
UPDATE config SET description = 'Hour in UTC to send batch emails. 15=6PM Dubai, 14=5PM Dubai, 16=7PM Dubai' WHERE key = 'batch_email_hour_utc';
UPDATE config SET description = 'Number of days before an active journey auto-expires with no activity' WHERE key = 'journey_expiry_days';
UPDATE config SET description = 'Number of days before journey expiry to send warning email to user' WHERE key = 'expiry_nudge_days';
UPDATE config SET description = 'Number of days before matches page token expires and user needs new link' WHERE key = 'match_token_expiry_days';
UPDATE config SET description = 'Number of days before an uncontacted match is marked as expired' WHERE key = 'match_expiry_days';
UPDATE config SET description = 'Number of days to wait before sending nudge email for inactive journey with expressed interest' WHERE key = 'interest_nudge_days';
UPDATE config SET description = 'Maximum number of active journeys allowed per user. Exceeded users must contact support' WHERE key = 'max_journeys_per_user';
UPDATE config SET description = 'Default notification channel. email=email only, whatsapp=WhatsApp only, both=email and WhatsApp' WHERE key = 'contact_preference';
UPDATE config SET value = 'ses' WHERE key = 'email_service';

-- =============================================
-- ADDITIONAL COLUMNS FOR MATCH INTEREST TRACKING
-- =============================================
ALTER TABLE matches ADD COLUMN IF NOT EXISTS interest_a TEXT CHECK (interest_a IN ('yes', 'no'));
ALTER TABLE matches ADD COLUMN IF NOT EXISTS interest_b TEXT CHECK (interest_b IN ('yes', 'no'));
