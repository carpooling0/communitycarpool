-- =============================================
-- COMMUNITY CARPOOL — CONFIG & SEED DATA BACKUP
-- Project: tbkjealpnoriwdosvmju (ap-southeast-1)
-- Generated: 2026-02-19
-- =============================================
-- Run AFTER backup-schema.sql
-- =============================================

-- ── CONFIG VALUES (live as of 2026-02-19) ────────────────────────────────────
INSERT INTO config (key, value, options, description) VALUES

-- Email toggles
('send_confirmation_email',   'false',    'true, false',
 'Send confirmation email when user submits a journey'),
('match_notification_enabled','true',     'true, false',
 'Send batch match emails to users'),
('expiry_nudge_enabled',       'true',    'true, false',
 'Send nudge email before journey expires'),
('interest_nudge_enabled',     'true',    'true, false',
 'Send nudge when inactive journey receives interest'),
('mutual_match_email_enabled', 'true',    'true, false',
 'Send immediate email when mutual match confirmed'),

-- Email frequency & provider
('email_frequency',    'daily',    'daily, mwf, weekly, monthly',
 'How often to send batch emails'),
('email_service',      'resend',   'resend, sendgrid, ses',
 'Email provider — resend in production, ses as fallback'),
('batch_email_hour_utc','15',      NULL,
 'Hour in UTC for batch emails. 15=6PM Dubai'),

-- Numeric configs
('journey_expiry_days',      '90',   NULL, 'Days before active journey auto-expires'),
('expiry_nudge_days',         '7',   NULL, 'Days before expiry to send nudge email'),
('match_token_expiry_days',  '60',   NULL, 'Days before match page token expires'),
('match_expiry_days',        '30',   NULL, 'Days before uncontacted match marked expired'),
('interest_nudge_days',       '7',   NULL, 'Days before nudge sent for inactive journey with interest'),
('max_journeys_per_user',    '10',   NULL, 'Maximum active journeys per user (overridable per-user via users.journey_limit)'),

-- Distance & matching
('distance_method',    'haversine', 'haversine, mapbox',
 'Distance calculation method. haversine=free'),
('matching_method',    'haversine', 'haversine, hybrid',
 'Match verification method'),
('matching_mode',      'hybrid',    'hybrid, instant, batch',
 'When to find and notify matches. hybrid=find instantly, email on schedule'),

-- WhatsApp & contact
('whatsapp_enabled',   'false',  'true, false',
 'Show WhatsApp field on form'),
('contact_preference', 'email',  'email, whatsapp, both',
 'Default notification channel'),

-- Testing mode (SET TO false BEFORE PRODUCTION CUTOVER)
('testing_mode', 'true', 'true, false',
 'TESTING: true=only send emails to whitelist in batch-send-emails. Set false for production.')

ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  options = EXCLUDED.options,
  description = EXCLUDED.description;

-- ── ORGANISATIONS ─────────────────────────────────────────────────────────────
INSERT INTO organisations (org_code, org_name, allow_cross_matching, is_active)
VALUES ('damac', 'DAMAC Properties', false, true)
ON CONFLICT (org_code) DO NOTHING;

INSERT INTO org_locations (org_id, location_name, location_latlng, is_active)
SELECT o.org_id, loc.name, loc.latlng, true
FROM organisations o
CROSS JOIN (VALUES
  ('Shatha Tower, Al Sufouh',                    '25.0895035,55.1530186'),
  ('DAMAC Executive Heights, Barsha Heights',     '25.0953478,55.1728533')
) AS loc(name, latlng)
WHERE o.org_code = 'damac'
ON CONFLICT DO NOTHING;

-- ── NOTES ─────────────────────────────────────────────────────────────────────
-- After restoring, set testing_mode = 'false' when ready for production:
--   UPDATE config SET value = 'false' WHERE key = 'testing_mode';
--
-- TEST WHITELIST in batch-send-emails edge function (index.ts line ~10):
--   const TEST_WHITELIST = ['nry76@hotmail.com', 'yalama@gmail.com', 'anvithy09@gmail.com']
-- Remove or empty this array when going to production.
