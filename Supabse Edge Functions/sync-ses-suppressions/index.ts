// ── SES suppression list → users.email_bounced ───────────────────────────────
// SES puts an address on its account-level suppression list after a hard bounce or a spam
// complaint, and then refuses to send to it. Our own database never heard about it (the
// Resend webhook only handles Resend), so we kept matching and "emailing" dead addresses.
// This reads the list daily and flags those users, so batch-send-emails skips them.
//
// Needs the SES IAM permission ses:ListSuppressedDestinations. Internal only (cron).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.19'
import { requireInternal, logSecurityEvent } from '../_shared/security.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)

const json = (data: object, status = 200) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' }, status })

Deno.serve(async (req) => {
  const denied = await requireInternal(req, supabase, 'sync-ses-suppressions')
  if (denied) return denied

  const keyId = Deno.env.get('AWS_ACCESS_KEY_ID')
  const secret = Deno.env.get('AWS_SECRET_ACCESS_KEY')
  const region = Deno.env.get('AWS_REGION') || 'ap-south-1'
  if (!keyId || !secret) return json({ success: false, error: 'AWS credentials not configured' }, 500)
  const aws = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, region, service: 'ses' })

  try {
    const addresses: { email: string; reason: string }[] = []
    let nextToken: string | undefined
    for (let page = 0; page < 30; page++) {   // 30 pages x 1000 is far more than we will ever have
      const qs = new URLSearchParams({ PageSize: '1000' })
      if (nextToken) qs.set('NextToken', nextToken)
      const res = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/suppression/addresses?${qs}`)
      if (!res.ok) {
        const text = await res.text()
        if (res.status === 403) {
          return json({ success: false, error: 'SES denied access. Add ses:ListSuppressedDestinations to the IAM user.', detail: text.slice(0, 300) }, 502)
        }
        return json({ success: false, error: `SES error ${res.status}`, detail: text.slice(0, 300) }, 502)
      }
      const data = await res.json()
      for (const row of data.SuppressedDestinationSummaries || []) {
        addresses.push({ email: String(row.EmailAddress).toLowerCase(), reason: row.Reason })
      }
      nextToken = data.NextToken
      if (!nextToken) break
    }

    // Flag matching users who are not flagged yet
    let newlyFlagged = 0
    const nowIso = new Date().toISOString()
    for (let i = 0; i < addresses.length; i += 200) {
      const chunk = addresses.slice(i, i + 200).map(a => a.email)
      const { data } = await supabase.from('users')
        .update({ email_bounced: true, email_bounced_at: nowIso })
        .in('email', chunk).eq('email_bounced', false).select('user_id')
      newlyFlagged += data?.length || 0
    }

    await logSecurityEvent(supabase, 'ses_suppression_sync', null, null, { suppressed: addresses.length, newlyFlagged })
    return json({ success: true, suppressedAddresses: addresses.length, newlyFlagged })
  } catch (err: any) {
    console.error('sync-ses-suppressions error:', err)
    return json({ success: false, error: 'Sync failed' }, 500)
  }
})
