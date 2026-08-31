# Community Carpool - Project Memory

## Project
- Mirror copy of this memory file exists at `/Users/ny/Downloads/Carpooling CodeBase/CLAUDE_MEMORY.md` (user requested 2026-08-03, so they can reopen/reference from the project folder directly). It is a manual snapshot, NOT auto-synced — whenever this MEMORY.md is meaningfully updated, also refresh CLAUDE_MEMORY.md to match, or explicitly tell the user it is stale
- Supabase project: `ccp`, ID: `tbkjealpnoriwdosvmju`, region: `ap-southeast-1`
- Codebase: `/Users/ny/Downloads/Carpooling CodeBase/`
- Edge functions dir: `Supabse Edge Functions/` (note typo in folder name); `supabase/functions/` is a symlink to it
- Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRia2plYWxwbm9yaXdkb3N2bWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMTg2ODAsImV4cCI6MjA4Njg5NDY4MH0.K0iS87GLgAZhYwFIQNphVFrarMzFxECkFYFvxpeVcsA`

## Deployment (CRITICAL)
- **DO NOT deploy without explicit user instruction. ALWAYS dev first, prod only when asked.**
- Frontend: `bash deploy-dev.sh` / `bash deploy-prod.sh` — NEVER raw git push
- Edge functions: `supabase functions deploy <name> --project-ref tbkjealpnoriwdosvmju --use-api`
- Dev project ref: `jboohdwihsiuvyrfeftp` | Prod ref: `tbkjealpnoriwdosvmju`
- `dev-repo` → `carpooling0/communitycarpool-dev` | `origin` → `carpooling0/communitycarpool` (prod)
- Deploy scripts use SSH via `~/.ssh/id_ed25519_carpooling0` / alias `github-carpooling0`

## admin-api (CRITICAL)
- **Deploy with `--no-verify-jwt`** — uses hex session tokens, not Supabase JWTs; gateway rejects otherwise
- **CRITICAL, verified on prod 2026-08-31: `admin-api` is NOT the only function with verify_jwt off.** Seven of the nine deletion/email functions run with `verify_jwt: false` — `admin-api`, `admin-auth`, `confirm-deletion`, `manage-deletion`, `request-deletion`, `school-share-batch`, `submit-support-ticket`. Only `batch-send-emails` and `process-deletions` have it **on**. There is no `config.toml`, so the flag is set per deploy: redeploying any of the seven WITHOUT `--no-verify-jwt` silently re-enables JWT verification and breaks them. **Always run `supabase functions list` and read the `verify_jwt` column before deploying, then match it per function.**
- **CORRECTED 2026-08-30: `DB_URL`/`DB_SERVICE_KEY` ARE set in prod.** Proven by probing `submit-intern-application` and `submit-support-ticket`: both call `createClient(Deno.env.get('DB_URL')!, ...)` at module scope, and supabase-js 2.112.4 throws `supabaseUrl is required.` on a falsy value, so the clean `400` they return proves the module booted with real values. The old "not set in prod" claim was wrong, or scoped only to `admin-api`/`sync-analytics`. Do not repeat it without re-probing.
- `admin-api` and `sync-analytics` use the `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` fallbacks (fixed 2026-06-28)
- Same fallbacks in `sync-analytics` and `admin-api` analytics.sync handler (fixed 2026-06-28)

## Key Config Values
- testing_mode: false | match_notification_enabled: true | data_retention_days: 30
- **`support_notify_email` = `carpooling0@gmail.com` (with the zero).** Confirmed by the user 2026-08-30: same value in prod AND dev. This file previously said `carpooling@gmail.com` without the zero, which was WRONG and appears nowhere in the codebase. Never quote the no-zero form. The same address is used in `privacy.html`, `docs/partner-faq.html`, `docs/super-admin/ropa.html` and `submit-intern-application`.
- match_token_expiry_days: 120

## Architecture Notes
- All DB access via service role in edge functions — RLS on, no policies = correct
- spatial_ref_sys: PostGIS system table, can't enable RLS, safe to ignore
- get-matches-page: verify_jwt:true — requires valid anon JWT
- unsubscribe.html POST sends camelCase keys (unsubscribedMatches etc.)
- Supabase Data API Grant: tables created after May 30 2026 need `GRANT ALL ON public.table TO service_role;`
- Campaign Links panel (admin.html) reads/writes `referral_links` table (links.save/links.list in admin-api) — purely a bookkeeping UI, does NOT gate tracking
- Org attribution (`?client=xxx` URLs) is independent: `submit-journey` looks up `organisations.org_code` directly — works even if the link was never registered in `referral_links` (e.g. QR code made via 3rd-party tool). Only downside of skipping admin.html link generation is it won't show in the Campaign Links history list; backfill manually via SQL insert into `referral_links` if needed

## Umami Analytics (updated 2026-06-29)
- Umami API requires Pro ($20/mo) — free plan blocked; sync pipeline abandoned
- Share URL: `https://cloud.umami.is/analytics/eu/share/pLzd0HUQsDeDiOCm?unit=day`
- admin.html: dedicated "Umami Analytics" nav panel with lazy-loaded iframe; Safari content blocker blocks it
- Web Traffic KPI section removed from Dashboard; `analytics_daily` table has all-zero June data

## Edge Function Inventory — Parity Notes (updated 2026-08-31)
- **Counts confirmed 2026-08-31: prod 33, dev 36.** Every deployed function now has source in the repo (36 local dirs, no gap either direction) after commit `7ed536e`
- Dev-only, deliberate: `fetch-reddit-posts`, `school-share-test`, `email-events-query` — Reddit agent tooling is intentionally dev-only, not a gap to close
- `school-share-batch` was prod-only; it is now on both and version-controlled
- Recover any source-less deployed function with `supabase functions download <fn> --project-ref <ref>` run from the repo root (the `supabase/functions` symlink puts it in the right place)
- `get-form-config` (WA field visibility flag) was dev-only, causing a silent 404 on every prod page load — deployed to prod 2026-08-03, now live on both
- `ezbr_sha256` in `list_edge_functions`/`get_edge_function` is a hash of the deployed bundle artifact, NOT the source text — it embeds the project ref + build path, so it will always differ between prod and dev even for byte-identical source. Don't use it to judge drift; diff actual source via `get_edge_function` instead
- Both: all core functions + `carpool-confirm`
- `required_terms_version` config had drifted (prod 1.2, dev 1.1) — synced dev to 1.2 on 2026-08-03

## WhatsApp Feature (suppressed in both envs — 2026-06-03)
- **PAUSED 2026-08-07 — explicit user call, cost-driven.** Do not resume prod rollout work unless user reopens it.
- Provider: Meta WhatsApp Business API (Cloud API)
- WA PIN blocked — Meta requires company verification for Utility templates
- `match_notification_cc` template ✅ approved & tested on dev
- Config keys all false — nothing fires until enabled
- WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID needed in BOTH dev and prod (prod pending deploy)
- Next (when unpaused): deploy WA schema + config + secrets + functions to prod (all keys off)

## Frontend Notes
- `index.html` = redesigned landing page; backup at `index-backup-2026-05-02.html`
- Share buttons route through `/share/*.html` — avoids ad/popup blocker interference
- Email icons at `/email-icons/` (PNG) — do not replace with external URLs
- Umami script loads from `umami.js` at end of `<body>`
- RESEND_FROM_EMAIL = `hello@mail.communitycarpool.org` (Resend sender — being replaced by SES)

## Email Provider (updated 2026-06-30)
- Provider switching via `email_service` config key — **no deploy needed, takes effect immediately**
- Options: `resend`, `ses`, `sendgrid`. Current values UNVERIFIED from this machine — read them with `SELECT value FROM config WHERE key='email_service';` rather than trusting this file. (This line previously said Prod=`resend`, which contradicted the 2026-06-30 line below saying both are `ses`.)
- `_shared/send-email.ts` — routes to provider based on config; SES uses v2 JSON API (aws4fetch)
- `_shared/pin-email.ts` — both PIN functions now use `sendEmail()`, no hardcoded Resend calls
- SES: Mumbai region (`ap-south-1`), from `hello@email.communitycarpool.org`
- SES verified identities: `email.communitycarpool.org` (DKIM + SPF + MX set up) + `partners@communitycarpool.org`
- `email.communitycarpool.org` subdomain used to protect main domain reputation
- DMARC changed to relaxed (`adkim=r; aspf=r`) — fixes MAIL FROM alignment warnings in SES
- BIMI warnings (logo in inbox) — low priority, ignore ($1,500/yr VMC, not worth it)
- Dev secrets set: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION=ap-south-1, SES_FROM_EMAIL=hello@email.communitycarpool.org
- Prod + dev: fully live on SES as of 2026-06-30 — all functions deployed, `email_service` = `ses`
- **NOT all Resend calls were removed.** That earlier claim covered only the functions it listed. Verified 2026-08-30 by `grep -rln "api.resend.com"`: six functions still hardcode Resend and ignore `email_service` — `request-deletion`, `manage-deletion`, `confirm-deletion`, `admin-auth`, `submit-support-ticket`, `admin-api`. See [[project-resend-ses-drift]].
- process-deletions cron scheduled: `0 22 * * *` via pg_cron on both prod and dev
- SES custom MAIL FROM: `send.email.communitycarpool.org` (MX + SPF in Cloudflare)
- DMARC: relaxed (`adkim=r; aspf=r`) — MAIL FROM alignment warnings resolved
- DB lookup on every send (getEmailService()) — negligible at current volume, optimise if needed later
- BIMI warnings in SES console — ignore, $1,500/yr VMC not worth it
- `communitycarpool.org` SES identity deleted — sending only from `email.communitycarpool.org`
- 2026-07-11/16: AWS Health sent DKIM-disabled then DKIM-revoked alerts for `communitycarpool.org` in Mumbai (ap-south-1) — expected/harmless, confirms the intentional identity deletion above; `email.communitycarpool.org` unaffected

## Dev-only Secrets (context)
- AWS_BEDROCK_* + SITE_URL → used by Reddit automated post agent (fetch-reddit-posts function)
- WHATSAPP_* → WhatsApp feature (suppressed, pending prod deploy)

## GitHub & SSH
- Backup repo: daily pg_dump at 20:00 UTC → `backups/backup_YYYY-MM-DD.sql.gz`, 7-day retention
- SSH keys: `~/.ssh/id_ed25519_carpooling0` (carpooling0) | `~/.ssh/id_ed25519_aydxb09` (personal)

## Config Table
- 4 columns: `key`, `value`, `options`, `allowed_values` — always include description + options on new keys

## pg_cron Jobs (updated 2026-08-03)
- `keep-warm-get-matches-page` / `keep-warm-submit-journey` run every 2 min on both prod and dev — intentionally this frequent to keep edge functions warm (avoid cold starts on submit), not just to prevent 7-day free-tier hibernation. Do not slow these down.
- These were silently failing on every run since creation (`net.http_request` does not exist in this pg_net version — only `http_get`/`http_post`/`http_delete` do). Fixed 2026-08-03 by switching to `net.http_get(...)`.
- `purge-cron-job-run-details` (new, 2026-08-03): daily job, `0 3 * * *`, deletes `cron.job_run_details` rows older than 3 days on both prod and dev — needed because the 2-min keep-warm jobs bloat this table fast (was 186K/162K rows before first cleanup)
- After the first bulk cleanup, `cron.job_run_details` was still 109 MB (prod) / 95 MB (dev) on disk despite low row count — plain `DELETE` + autovacuum reclaims space for reuse but does not shrink the file; ran `VACUUM FULL cron.job_run_details` once to reclaim it (109 MB → 2.4 MB prod, 95 MB → 2.6 MB dev). Not needed again regularly since the daily purge now keeps row count low going forward (steady-state churn, not a growing backlog) — only worth another manual VACUUM FULL if the table balloons again
- Checked all other tables on both projects (2026-08-03) for similar bloat — nothing else found. `spatial_ref_sys` (~7 MB, PostGIS system table) is fixed size; everything in `public` schema is small

## Outstanding
- Deploy WA to prod: schema → config keys → secrets → edge functions → frontend (all WA keys off) — PAUSED, cost-driven (2026-08-07)
- `_shared/send-whatsapp.ts` — deploy to prod as part of WhatsApp rollout (paused)
- **`email_verification_enabled` still `false` on dev** — flipped off 2026-08-07 for a demo (skips PIN step on `submit-journey`). Needs to be flipped back to `true` when dev should require email verification again; not yet confirmed reverted.
- **Bug fixed 2026-08-07, both envs:** `batch-send-emails`' `match_email_sent`/`match_email_failed` event-log inserts were fire-and-forget (not `await`ed) — same class of bug as the token-expiry fix below. The actual `sendEmail()` call was already awaited so emails always sent correctly; only the audit-log event could silently fail to persist if the Deno isolate was torn down right after the response. Fixed by awaiting both inserts. Deployed and smoke-tested on dev (v50) and prod (v51) — both returned clean `200` with no runtime error.
- **Known issue, explicitly declined (2026-08-07):** `confirm-deletion` double-click UX — clicking an already-used deletion confirmation link a second time shows "Invalid or expired link" instead of "already confirmed" (the `alreadyConfirmed` code branch is unreachable because `deletion_token` is nulled on first use). Cosmetic only — deletion itself is correct and safe. User does not want this touched — do not fix or re-raise unless asked.
- **Bug fixed 2026-08-07 (both envs, prod + dev):** `get-matches-page`'s match-token sliding-expiry write (`token_created_at` refresh) and `submit-journey`'s equivalent were originally fire-and-forget and got silently dropped by Deno isolate teardown; fixed by `await`ing them. Also fixed the underlying design bug: token expiry was measured from account creation, not activity — now refreshes on every real matches-page visit, new journey submission, and outbound match email. Extensively tested end-to-end on prod (new user → journey → match → mutual interest → deletion) using synthetic accounts on a Dubai→New York route to avoid touching real users.
- **Bug fixed 2026-08-03 (found 2026-07-30, both envs):** `process-deletions/index.ts` never checked `{ error }` on any `.delete()` call, and never cleaned up `events` rows by `submission_id` (only by `user_id`/`match_id`). An orphaned event referencing a submission caused a silent FK-violation failure on the submissions/users delete, while the function still logged "deleted" and emailed success. Confirmed this silently failed nightly for 100+ days for one dev test user before being caught. Fixed: added `events(submission_id)` cleanup step + explicit error-checking `del()` helper that throws on any failed delete. Deployed and verified on dev (reproduced the exact orphan scenario, confirmed real deletion) and prod.

## Feedback
- [Always deploy via .sh scripts](feedback_deployment_scripts.md) — never raw git push
- **NEVER deploy to prod without explicit "deploy to prod" instruction**
- [Never use em-dashes](feedback_no_emdashes.md) — in any written output, no exceptions
- [Never use contractions](feedback_no_contractions.md) — spell words out in full in any written output
- [Verify cron execution, not just existence](feedback_verify_cron_execution.md) — check `cron.job_run_details`, don't assume a scheduled job is succeeding
- [Never hardcode Supabase config in a page](feedback_never_hardcode_supabase_config.md) — always load `config.js`, or dev writes to prod
- [Name test data ZZ TEST_dev](feedback_test_data_naming.md) — the only marker for synthetic accounts; beware email_whitelist when creating matchable journeys
- [Verify before quoting config values](feedback_verify_before_quoting_config.md) — a remembered address/secret is not live state; check it or label it unverified

## Session state 31 Aug 2026 — READ THIS FIRST when resuming
- [Session 31 Aug state](project_session_2026_08_31.md) — what is on dev vs prod, the Delete Now bug, lifecycle test results, what is still pending

## Partners Page (new 2026-08-30)
- [Partners marketing page](project_partners_page.md) — partners.html done, Supabase table + function written but NOT applied
- [Brand typography drift](project_brand_typography_drift.md) — index.html headings still Playfair, guideline says Montserrat
- [Supabase CLI auth](reference_supabase_cli_auth.md) — CORRECTED: use `SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase/carpool-token)`; `--profile` silently falls back to the wrong account
- [CLI multi-account](reference_supabase_cli_multi_account.md) — `--profile` / `SUPABASE_ACCESS_TOKEN` to reach carpooling0 without logging out
- [Resend/SES drift](project_resend_ses_drift.md) — RESOLVED on dev 2026-08-31, all 7 functions now use the shared sender; NOT on prod
- [Deletion architecture](project_deletion_architecture.md) — the two paths, the 30-day clock, why the split is not ready, Delete Now is a deliberate override
- [Intern page rebrand](project_intern_page_rebrand.md) — intern.html rebuilt on the brand system, on dev 2026-08-31, NOT on prod; partners.html is the canonical brand reference

## Other Projects
- [Community Carpool GitHub portfolio cleanup](project_communitycarpool_portfolio.md) — `AYDXB09/communitycarpool-dev` fork, separate from the real business repos above; cleanup done 2026-08-07, stays private until check-in 2026-11-15
- [Lumina (School AI)](project_lumina.md) — GitHub: AYDXB09/school-ai | Local: /Users/ny/Downloads/CursorProjects/School-AI/school-ai/
- [Landing page redesign](project_landing_page_design.md) — Next.js + Tailwind, DO NOT build until wireframe approved
- [Landing page template](project_landing_template.md) — `landing-template.html` in project root
- [Platform scope](project_platform_scope.md) — global platform, Dubai is initial market
- [QR code spec](project_qr_code_spec.md) — style/colors/generator (QR Code Monkey) for campaign link QR codes
