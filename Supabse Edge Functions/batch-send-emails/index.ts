import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/send-email.ts'
import { sendWhatsAppTemplate } from '../_shared/send-whatsapp.ts'
import { requireInternal, escapeHtml } from '../_shared/security.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Privileged: only the cron jobs and our own functions (service-role key) may call this.
  const denied = await requireInternal(req, supabase, 'batch-send-emails', corsHeaders)
  if (denied) return denied

  // ── Preview / test mode ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const testTo = url.searchParams.get('test_to')
    if (testTo) {
      const shareBase = 'https://communitycarpool.org/share'
      const previewToken = 'preview-token-000'
      const batchDate = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dubai' })
      const previewRow = `<tr><td style="padding:20px 0;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:700;color:#111827;margin-bottom:10px;font-size:15px;">Journey #1</div>
        <div style="font-size:14px;color:#374151;margin-bottom:4px;"><span style="color:#16a34a;font-size:12px;">&#9679;</span>&nbsp;Dubai Marina</div>
        <div style="font-size:13px;color:#9ca3af;margin:0 0 4px 6px;">&#8595;</div>
        <div style="font-size:14px;color:#374151;margin-bottom:12px;"><span style="color:#dc2626;font-size:12px;">&#9679;</span>&nbsp;Dubai International Financial Centre (DIFC)</div>
        <div style="font-size:13px;color:#15803d;font-weight:600;margin-bottom:10px;">🎉 2 new matches!</div>
        <a href="${SITE_URL}/matches.html?token=${previewToken}&journey=1" style="display:inline-block;background:#16a34a;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View Matches &#x2192;</a>
      </td></tr>`
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
        <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
          <div style="text-align:center;margin-bottom:32px;">
            <a href="${SITE_URL}" style="text-decoration:none;">
              <img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:64px;width:auto;display:block;margin:0 auto;" />
            </a>
          </div>
          <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <h2 style="color:#111827;font-size:20px;margin:0 0 4px;">Hi Alex!</h2>
            <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">Your Carpool Update &mdash; ${batchDate}</p>
            <table width="100%" cellpadding="0" cellspacing="0">${previewRow}</table>
          </div>
          <!-- Journey Tracker — Step 2 active -->
          <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;text-align:center;">Your Carpool Status</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
              <tr>
                <td align="center" width="20%">
                  <div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div>
                  <div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;line-height:1.3;word-break:break-word;">Joined the Pool</div>
                </td>
                <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#1B5C3A;"></div></td>
                <td align="center" width="20%">
                  <div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">2</div>
                  <div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div>
                </td>
                <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
                <td align="center" width="20%">
                  <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">3</div>
                  <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div>
                </td>
                <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
                <td align="center" width="20%">
                  <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">4</div>
                  <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div>
                </td>
              </tr>
            </table>
          </div>
          <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
            <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">The more people in your area sign up, the better the matches get.</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
              <td style="padding:0 5px;"><a href="${shareBase}/whatsapp.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
              <td style="padding:0 5px;"><a href="${shareBase}/facebook.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
              <td style="padding:0 5px;"><a href="${shareBase}/x.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="X" /></a></td>
              <td style="padding:0 5px;"><a href="${shareBase}/linkedin.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
              <td style="padding:0 5px;"><a href="${shareBase}/sms.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
            </tr></table>
          </div>
          <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:14px;">
            <p style="margin:0 0 6px;">
              <a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;
              <a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;
              <a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;
              <a href="${SITE_URL}/unsubscribe.html?token=${previewToken}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;
              <a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a>
            </p>
          </div>
        </div></body></html>`
      await sendEmail(testTo, `Your Carpool Update — ${batchDate}`, html)
      return new Response(JSON.stringify({ preview: true, to: testTo }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  }

  try {
    if (await getConfig('match_notification_enabled') !== 'true') {
      return new Response(JSON.stringify({ success: true, message: 'Notifications disabled' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Check testing mode (default: true until explicitly set to 'false')
    const testingMode = (await getConfig('testing_mode')) !== 'false'
    // The provider that will actually be used, read from the same config key
    // _shared/send-email.ts routes on. Previously this was hardcoded to
    // 'resend' in the response, and inferred backwards from whether a message
    // id came back when writing events — sendEmail returns an id for BOTH
    // providers, so those event rows were mislabelled.
    const emailProvider = (await getConfig('email_service')) || 'resend'

    const { data: allUnsent, error } = await supabase.from('matches')
      .select(`
        match_id, sub_a_id, sub_b_id, match_strength, notified_a_at, notified_b_at,
        sub_a:submissions!sub_a_id!inner (submission_id, email_verification_status, from_location, to_location, journey_num, user_id, whatsapp_number, whatsapp_verification_status, users(name, email, match_page_token, email_whitelist, unsubscribed_matches, unsubscribed_whatsapp, deletion_requested_at, email_bounced)),
        sub_b:submissions!sub_b_id!inner (submission_id, email_verification_status, from_location, to_location, journey_num, user_id, whatsapp_number, whatsapp_verification_status, users(name, email, match_page_token, email_whitelist, unsubscribed_matches, unsubscribed_whatsapp, deletion_requested_at, email_bounced))
      `).eq('notification_sent', false).in('status', ['new', 'notified'])
      .in('sub_a.email_verification_status', ['email_verified', 'verification_skipped'])
      .in('sub_b.email_verification_status', ['email_verified', 'verification_skipped'])
      .order('match_id', { ascending: true })
      .limit(2500)   // Free tier: 256 MB memory and 2 s CPU per invocation. Anything beyond this stays pending for the next run.
    if (error) throw error
    // Only matches where BOTH journeys belong to a verified email address are sent. A match
    // with an unverified side stays pending and is picked up once that side verifies.
    const MATCHABLE = ['email_verified', 'verification_skipped']
    const unsentMatches = (allUnsent || []).filter((m: any) =>
      m.sub_a?.users && m.sub_b?.users &&
      MATCHABLE.includes(m.sub_a.email_verification_status) && MATCHABLE.includes(m.sub_b.email_verification_status))
    if (unsentMatches.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No unsent matches' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Minimum gap between two match emails to the same person, derived from email_frequency.
    // Matches that arrive in between are NOT dropped: they stay pending and go out in the
    // first run after the gap, grouped into one email.
    const freq = (await getConfig('email_frequency')) || 'daily'
    const minHours = ({ daily: 20, mwf: 40, weekly: 144, monthly: 648 } as Record<string, number>)[freq] ?? 20

    const batchId = crypto.randomUUID()
    const batchDate = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dubai' })

    // Group new matches by user email
    const userMatches: { [email: string]: any } = {}
    for (const match of unsentMatches) {
      for (const [side, sub] of [['a', match.sub_a], ['b', match.sub_b]] as const) {
        if (match[`notified_${side}_at`]) continue   // this person was already told about this match
        const userEmail = sub.users.email
        if (!userMatches[userEmail]) userMatches[userEmail] = { name: sub.users.name, token: sub.users.match_page_token, userId: sub.user_id, emailWhitelist: sub.users.email_whitelist === true, unsubscribedMatches: sub.users.unsubscribed_matches === true, unsubscribedWhatsapp: sub.users.unsubscribed_whatsapp === true, deletionRequested: !!sub.users.deletion_requested_at, emailBounced: sub.users.email_bounced === true, newJourneys: {} }
        if (!userMatches[userEmail].newJourneys[sub.submission_id]) {
          userMatches[userEmail].newJourneys[sub.submission_id] = { journeyNum: sub.journey_num, fromLocation: sub.from_location, toLocation: sub.to_location, newMatchCount: 0, waNumber: sub.whatsapp_number || null, waVerified: sub.whatsapp_verification_status === 'whatsapp_verified' }
        }
        userMatches[userEmail].newJourneys[sub.submission_id].newMatchCount++
      }
    }

    let emailsSent = 0, emailsFailed = 0, emailsSkipped = 0
    // match_id -> which sides ('a' / 'b') were emailed in this run
    const emailedSides = new Map<number, Set<string>>()
    const emailedSubmissionIds = new Set<number>()

    // Free tier: an invocation is cut off after 150 s. Stop starting new emails at ~110 s so
    // everything sent is still recorded below; whoever is left stays pending for the next run.
    const runStarted = Date.now()
    let timeBudgetHit = false

    for (const [email, userData] of Object.entries(userMatches) as any) {
      if (Date.now() - runStarted > 110_000) { timeBudgetHit = true; break }
      // ── HARD SKIP: bounced, unsubscribed, or deletion requested ──
      if (userData.emailBounced || userData.unsubscribedMatches || userData.deletionRequested) {
        emailsSkipped++
        console.log(`[SKIP] ${email} — bounced: ${userData.emailBounced}, unsubscribed: ${userData.unsubscribedMatches}, deletion pending: ${userData.deletionRequested}`)
        continue
      }

      // ── TESTING WHITELIST: skip non-whitelisted emails in testing mode ──
      // Whitelist is controlled per-user via users.email_whitelist = true
      if (testingMode && !userData.emailWhitelist) {
        emailsSkipped++
        console.log(`[TESTING MODE] Skipping email to ${email} — match stays 'new' for real send later`)
        continue
      }

      // Claim this person atomically. Overlapping runs (or a manual trigger) cannot both
      // claim the same user, so nobody is emailed twice inside the interval. If the send
      // fails the claim is released below and the matches stay pending.
      const claim = await supabase.rpc('claim_match_email', { p_user_id: userData.userId, p_min_hours: minHours }).single()
      if (claim.error || !claim.data) {
        emailsSkipped++
        console.error(`[SKIP] ${email}: could not claim (${claim.error?.message}); not sending`)
        continue
      }
      if (!claim.data.claimed) {
        emailsSkipped++
        console.log(`[SKIP] ${email}: already emailed within ${minHours}h; matches stay pending`)
        continue
      }
      const prevClaim = claim.data.prev

      try {
        // Refresh token_created_at before sending — otherwise a long-tenured active
        // user whose account is already past match_token_expiry_days gets emailed a
        // link that's dead on arrival (expiry is measured from token_created_at, which
        // was previously only ever set once, at signup).
        await supabase.from('users').update({ token_created_at: new Date().toISOString() }).eq('user_id', userData.userId)

        // Fetch ALL active journeys for this user (not just ones with new matches)
        const { data: allSubs } = await supabase.from('submissions')
          .select('submission_id, journey_num, from_location, to_location, journey_status')
          .eq('user_id', userData.userId)
          .in('journey_status', ['active'])
          .order('journey_num', { ascending: true })

        // Build a map of subId → new match count for quick lookup
        const newSubMatchCount: { [subId: string]: number } = {}
        for (const [subId, journey] of Object.entries(userData.newJourneys) as any) {
          newSubMatchCount[subId] = journey.newMatchCount
        }

        // ALL active journeys get a green "View Matches →" button (consistent layout)
        // Journeys with new matches show a badge count; others just show route
        const allJourneyRows = (allSubs || [])
          .map((s: any) => {
            const newCount = newSubMatchCount[s.submission_id]
            const newBadge = newCount
              ? `<div style="font-size:13px;color:#15803d;font-weight:600;margin-bottom:10px;">🎉 ${newCount} new match${newCount > 1 ? 'es' : ''}!</div>`
              : ''
            return `
              <tr><td style="padding:20px 0;border-bottom:1px solid #e5e7eb;">
                <div style="font-weight:700;color:#111827;margin-bottom:10px;font-size:15px;">Journey #${Number(s.journey_num) || 0}</div>
                <div style="font-size:14px;color:#374151;margin-bottom:4px;"><span style="color:#16a34a;font-size:12px;">&#9679;</span>&nbsp;${escapeHtml(s.from_location)}</div>
                <div style="font-size:13px;color:#9ca3af;margin:0 0 4px 6px;">&#8595;</div>
                <div style="font-size:14px;color:#374151;margin-bottom:12px;"><span style="color:#dc2626;font-size:12px;">&#9679;</span>&nbsp;${escapeHtml(s.to_location)}</div>
                ${newBadge}
                <a href="${SITE_URL}/matches.html?token=${userData.token}&journey=${s.submission_id}" style="display:inline-block;background:#16a34a;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View Matches &#x2192;</a>
              </td></tr>`
          }).join('')

        if (!allJourneyRows) continue

        const shareBase = 'https://communitycarpool.org/share'

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
          <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
          <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
            <div style="text-align:center;margin-bottom:32px;">
              <a href="${SITE_URL}" style="text-decoration:none;">
                <img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:64px;width:auto;display:block;margin:0 auto;" />
              </a>
            </div>
            <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
              <h2 style="color:#111827;font-size:20px;margin:0 0 4px;">Hi ${escapeHtml(userData.name)}!</h2>
              <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">Your Carpool Update &mdash; ${batchDate}</p>
              <table width="100%" cellpadding="0" cellspacing="0">${allJourneyRows}</table>
            </div>
            <!-- Journey Tracker — Step 2 active -->
            <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
              <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;text-align:center;">Your Carpool Status</div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                <tr>
                  <td align="center" width="20%">
                    <div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div>
                    <div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;line-height:1.3;word-break:break-word;">Joined the Pool</div>
                  </td>
                  <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#1B5C3A;"></div></td>
                  <td align="center" width="20%">
                    <div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">2</div>
                    <div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div>
                  </td>
                  <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
                  <td align="center" width="20%">
                    <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">3</div>
                    <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div>
                  </td>
                  <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
                  <td align="center" width="20%">
                    <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">4</div>
                    <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div>
                  </td>
                </tr>
              </table>
            </div>
            <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
              <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
              <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">The more people in your area sign up, the better the matches get.</p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                <td style="padding:0 5px;"><a href="${shareBase}/whatsapp.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
                <td style="padding:0 5px;"><a href="${shareBase}/facebook.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
                <td style="padding:0 5px;"><a href="${shareBase}/x.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Twitter / X" /></a></td>
                <td style="padding:0 5px;"><a href="${shareBase}/linkedin.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
                <td style="padding:0 5px;"><a href="${shareBase}/sms.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
              </tr></table>
            </div>
            <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:14px;">
              <p style="margin:0 0 6px;">
                <a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;
                <a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;
                <a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;
                <a href="${SITE_URL}/unsubscribe.html?token=${userData.token}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;
                <a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a>
              </p>
            </div>
          </div></body></html>`

        const emailMsgId = await sendEmail(email, `Your Carpool Update \u2014 ${batchDate}`, html, [
          { name: 'batch_id', value: batchId },
          { name: 'type',     value: 'match_notification' }
        ])
        emailsSent++
        // Log to general events table — must be awaited, otherwise the Deno isolate
        // can be torn down right after the response is sent, silently dropping this
        // write even though the actual email above sent successfully.
        await supabase.from('events').insert({ event_type: 'match_email_sent', metadata: { email, batch_id: batchId, message_id: emailMsgId, provider: emailProvider } })

        for (const match of unsentMatches) {
          for (const [side, sub] of [['a', match.sub_a], ['b', match.sub_b]] as const) {
            if (sub.users.email === email && !match[`notified_${side}_at`]) {
              if (!emailedSides.has(match.match_id)) emailedSides.set(match.match_id, new Set())
              emailedSides.get(match.match_id)!.add(side)
              emailedSubmissionIds.add(sub.submission_id)
            }
          }
        }
      } catch (emailErr: any) {
        emailsFailed++
        await supabase.rpc('release_match_email', { p_user_id: userData.userId, p_prev: prevClaim })
        console.error(`Email failed for ${email}:`, emailErr.message)
        await supabase.from('events').insert({ event_type: 'match_email_failed', metadata: { email, error: emailErr.message, batch_id: batchId } })
      }
    }

    // ── WhatsApp match notifications (one per journey with new matches) ──────
    const waMatchesEnabled = (await getConfig('whatsapp_matches_notification_enabled')) === 'true'
    const waResults: any[] = []
    if (waMatchesEnabled) {
      for (const [, userData] of Object.entries(userMatches) as any) {
        if (userData.unsubscribedWhatsapp || userData.deletionRequested) continue
        if (testingMode && !userData.emailWhitelist) continue
        for (const [subId, journey] of Object.entries(userData.newJourneys) as any) {
          if (!journey.waNumber || !journey.waVerified) continue
          try {
            await sendWhatsAppTemplate(
              journey.waNumber,
              'match_notification_cc',
              [
                { parameter_name: 'first_name',   text: userData.name },
                { parameter_name: 'match_count',  text: String(journey.newMatchCount) },
                { parameter_name: 'from_location', text: journey.fromLocation },
                { parameter_name: 'to_location',   text: journey.toLocation },
              ],
              `${userData.token}&journey=${subId}`
            )
            console.log(`[WA] Match notification sent → ${journey.waNumber} (submission ${subId})`)
            waResults.push({ subId, to: journey.waNumber, status: 'sent' })
          } catch (waErr: any) {
            console.error(`[WA] Match notification failed for ${journey.waNumber}:`, waErr.message)
            waResults.push({ subId, to: journey.waNumber, status: 'failed', error: waErr.message })
          }
        }
      }
    }

    // ── Record what was sent, per side ───────────────────────────────────────
    // A match is complete once both people have been emailed or one of them can never be
    // reached (bounced, unsubscribed, deletion pending). Until then it stays pending, so a
    // person skipped this run (interval, testing mode) still gets it later.
    const nowIso = new Date().toISOString()
    const unreachable = (sub: any) => sub.users.email_bounced === true || sub.users.unsubscribed_matches === true || !!sub.users.deletion_requested_at
    const groups = new Map<string, { ids: number[]; update: Record<string, any> }>()
    for (const match of unsentMatches) {
      const sides = emailedSides.get(match.match_id) || new Set<string>()
      const aNotified = !!match.notified_a_at || sides.has('a')
      const bNotified = !!match.notified_b_at || sides.has('b')
      const complete = (aNotified || unreachable(match.sub_a)) && (bNotified || unreachable(match.sub_b)) && (aNotified || bNotified)
      if (sides.size === 0 && !complete) continue   // nothing happened to this match in this run
      const update: Record<string, any> = {}
      if (sides.size > 0) { update.status = 'notified'; update.email_batch_id = batchId }
      if (sides.has('a')) update.notified_a_at = nowIso
      if (sides.has('b')) update.notified_b_at = nowIso
      if (complete) { update.notification_sent = true; update.notification_sent_at = nowIso; update.status = 'notified' }
      const key = JSON.stringify(Object.keys(update).sort())
      if (!groups.has(key)) groups.set(key, { ids: [], update })
      groups.get(key)!.ids.push(match.match_id)
    }
    for (const { ids, update } of groups.values()) {
      for (let k = 0; k < ids.length; k += 200) {
        await supabase.from('matches').update(update).in('match_id', ids.slice(k, k + 200))
      }
    }
    // Heal: two overlapping runs can each record one side from a stale read. Whatever now has
    // both sides notified is complete, so it never lingers in the pending list.
    await supabase.from('matches').update({ notification_sent: true, notification_sent_at: nowIso })
      .eq('notification_sent', false).not('notified_a_at', 'is', null).not('notified_b_at', 'is', null)
    if (emailedSubmissionIds.size > 0) {
      await supabase.from('submissions').update({ last_notified_at: nowIso }).in('submission_id', [...emailedSubmissionIds])
    }

    return new Response(JSON.stringify({ success: true, emailsSent, emailsFailed, emailsSkipped, batchId, provider: emailProvider, testingMode, waResults, timeBudgetHit }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('batch-send-emails error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
