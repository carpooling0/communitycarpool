# Community Carpool — Backup & Restoration Guide

**Project:** tbkjealpnoriwdosvmju · ap-southeast-1
**Site:** communitycarpool.org (GitHub Pages: carpooling0/communitycarpool)

---

## What's in this folder

| File | Contents |
|------|----------|
| `backup-schema.sql` | Full DDL: all tables, indexes, functions (idempotent — safe to re-run) |
| `backup-config.sql` | Config table INSERT + organisations seed data |
| `backup-edge-functions.sh` | Script to zip all edge function source files |
| `edge-functions-YYYYMMDD_HHMMSS.zip` | Timestamped zip created when you run the script above |

---

## Edge Functions (current deployed versions)

| Function | Version | verify_jwt | Schedule |
|----------|---------|-----------|---------|
| submit-journey | v10 | false | On form submit |
| find-matches | latest | true | Called by submit-journey |
| get-matches-page | latest | false | On matches.html load |
| update-match-status | v11 | false | On Yes/No click |
| batch-send-emails | v17 | true | Cron: daily 3PM UTC (6PM Dubai) |
| deactivate-journey | latest | false | On Archive/Reactivate click |
| expire-journeys | latest | true | Cron: daily 10PM UTC (2AM Dubai) |
| track-event | latest | false | On user actions |

---

## Cron Jobs (Supabase cron via pg_cron or external scheduler)

```
# Daily match notification emails — 3PM UTC = 6PM Dubai
0 15 * * *   POST https://tbkjealpnoriwdosvmju.supabase.co/functions/v1/batch-send-emails
             Authorization: Bearer <SERVICE_ROLE_KEY>

# Daily journey expiry check — 10PM UTC = 2AM Dubai
0 22 * * *   POST https://tbkjealpnoriwdosvmju.supabase.co/functions/v1/expire-journeys
             Authorization: Bearer <SERVICE_ROLE_KEY>
```

---

## Restoration Steps (new Supabase project)

1. **Create new project** in Supabase dashboard (or CLI)

2. **Run schema** in SQL editor:
   ```
   Open: backup-schema.sql → paste into SQL editor → Run
   ```

3. **Run config** in SQL editor:
   ```
   Open: backup-config.sql → paste into SQL editor → Run
   ```

4. **Deploy edge functions** (requires Supabase CLI):
   ```bash
   supabase login
   supabase link --project-ref <NEW_PROJECT_REF>
   # Deploy each function:
   supabase functions deploy submit-journey --no-verify-jwt
   supabase functions deploy find-matches
   supabase functions deploy get-matches-page --no-verify-jwt
   supabase functions deploy update-match-status --no-verify-jwt
   supabase functions deploy batch-send-emails
   supabase functions deploy deactivate-journey --no-verify-jwt
   supabase functions deploy expire-journeys
   supabase functions deploy track-event --no-verify-jwt
   ```

5. **Set Edge Function secrets** in Supabase dashboard → Edge Functions → Secrets:
   ```
   DB_URL              = https://<project>.supabase.co
   DB_SERVICE_KEY      = <service_role_key>
   RESEND_API_KEY      = re_...
   RESEND_FROM_EMAIL   = hello@communitycarpool.org
   # Optional SES fallback:
   AWS_REGION          = us-east-1
   AWS_ACCESS_KEY_ID   = ...
   AWS_SECRET_ACCESS_KEY = ...
   SES_FROM_EMAIL      = hello@communitycarpool.org
   ```

6. **Update frontend config** in matches.html and index.html:
   ```js
   const SUPABASE_URL = 'https://<NEW_PROJECT>.supabase.co'
   const SUPABASE_ANON_KEY = '<new_anon_key>'
   ```

7. **Set up cron jobs** (see above)

8. **Update testing_mode** for production:
   ```sql
   UPDATE config SET value = 'false' WHERE key = 'testing_mode';
   ```

9. **Migrate user data** (150 CSV records) via the CSV import script.

---

## Key Config Values to Review Before Production

| Key | Current | Production target |
|-----|---------|-----------------|
| `testing_mode` | `true` | `false` |
| `send_confirmation_email` | `false` | `true` |
| `max_journeys_per_user` | `10` | `10` (or adjust) |
| `email_frequency` | `daily` | `daily` |
| `email_service` | `resend` | `resend` |

---

## Database Migrations Applied (in order)

1. `find_nearby_users_return_floats_v2` — returns float coords not WKB
2. `get_submission_coords_helper` — RPC for safe coord fetch
3. `add_interest_columns_to_matches` — interest_a, interest_b columns
4. `remove_duplicate_columns` — cleanup
5. `fix_get_submission_coords_v2` — JOIN fix
6. `fix_find_nearby_users_no_name_email` — JOIN fix
7. `insert_200_fake_users` — test data
8. `insert_nabil_8_more_journeys` — test data
9. `insert_225_counterpart_submissions` — test data
10. `insert_225_matches_varied_states` — test data
11. `rename_email_sent_to_notification_sent` — column rename
12. `add_lat_lng_float_columns_to_submissions` — adds from_lat, from_lng, to_lat, to_lng as plain FLOAT columns (backfilled from PostGIS); eliminates WKB parsing in edge functions

All these are reflected in `backup-schema.sql` (the schema is the final result).
