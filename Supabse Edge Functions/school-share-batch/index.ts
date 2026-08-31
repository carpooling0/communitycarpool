import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail as sendViaProvider } from '../_shared/send-email.ts'

// Falls back to the auto-injected vars so the module still boots if the
// DB_URL / DB_SERVICE_KEY vault secrets are absent — createClient throws at
// module scope on a falsy value, which would take the whole function down.
const supabase = createClient(
  Deno.env.get('DB_URL') || Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('DB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const SITE_URL = 'https://communitycarpool.org'
const PROD_REF_URL = 'https://communitycarpool.org?ref=013'
const KEYWORDS = ['school', 'nursery', 'academy', 'kindergarten', 'preschool', 'pre-school']

function hasSchoolKeyword(value: string | null | undefined): boolean {
  const lower = (value || '').toLowerCase()
  return KEYWORDS.some((keyword) => lower.includes(keyword))
}

function extractPoiName(value: string | null | undefined): string {
  const raw = (value || '').trim()
  if (!raw) return 'your school'
  return raw.split(' - ')[0].trim() || raw
}

function normalizeSchoolName(name: string): string {
  const replacements: Record<string, string> = {
    'Swiss International School in Dubai additional gate': 'Swiss International School in Dubai',
    'Raffles International English School and PU College': 'Raffles International English School',
    'Credence High School | Best Indian CBSE school in Dubai': 'Credence High School',
    'Dubai International Academy (DIA) Emirates Hills – KG1': 'Dubai International Academy (DIA) Emirates Hills',
    'Leaders Private School, Sharjah': 'Leaders Private School',
    'Leaders Private School مدرسة القادة الخاصة': 'Leaders Private School',
    'Bilingual French International School ICE | Lycée Français Bilingue International ICE': 'Lycée Français Bilingue International',
  }
  return replacements[name] || name
}

function pickSchoolName(fromLocation: string, toLocation: string): string {
  const toName = extractPoiName(toLocation)
  const fromName = extractPoiName(fromLocation)
  if (hasSchoolKeyword(toLocation)) return normalizeSchoolName(toName)
  if (hasSchoolKeyword(fromLocation)) return normalizeSchoolName(fromName)
  return 'your school'
}

function isFalsePositiveSchool(name: string): boolean {
  return name === '7X Head Office'
}

function buildShareButtons(schoolName: string): string {
  const shareUrl = encodeURIComponent(SITE_URL)
  const shareText = encodeURIComponent(`I have joined Community Carpool, a free platform that helps parents find school carpool matches based on their routes.\n\nThe more parents from ${schoolName} who join, the better the matches get.\n\nIt takes just 1 minute to add your route:\n${PROD_REF_URL}`)
  return `
    <div style="margin-top:18px;padding:16px 18px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;text-align:center;">
      <div style="font-size:15px;font-weight:700;color:#166534;margin-bottom:10px;">Or use the share buttons below to send it quickly.</div>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr>
          <td style="padding:4px;"><a href="https://wa.me/?text=${shareText}" style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:10px 12px;border-radius:8px;">WhatsApp</a></td>
          <td style="padding:4px;"><a href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" style="display:inline-block;background:#1877F2;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:10px 12px;border-radius:8px;">Facebook</a></td>
          <td style="padding:4px;"><a href="https://x.com/intent/tweet?text=${shareText}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:10px 12px;border-radius:8px;">X</a></td>
        </tr>
        <tr>
          <td style="padding:4px;"><a href="https://www.linkedin.com/shareArticle?mini=true&url=${shareUrl}&title=${encodeURIComponent('Community Carpool')}&summary=${encodeURIComponent('Free school carpool matching based on routes.')}" style="display:inline-block;background:#0A66C2;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:10px 12px;border-radius:8px;">LinkedIn</a></td>
          <td style="padding:4px;"><a href="sms:?body=${shareText}" style="display:inline-block;background:#22c55e;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:10px 12px;border-radius:8px;">SMS</a></td>
          <td style="padding:4px;"></td>
        </tr>
      </table>
    </div>`
}

function buildEmail(firstName: string, schoolName: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:620px;margin:0 auto;padding:32px 18px;">
      <div style="background:white;border-radius:16px;padding:28px 28px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <div style="text-align:center;margin-bottom:24px;">
          <img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:56px;width:auto;display:block;margin:0 auto 12px;" />
        </div>
        <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">Hi ${firstName},</p>
        <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">Thanks for joining Community Carpool.</p>
        <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">The more parents from <strong>${schoolName}</strong> who join, the better the matches get for everyone.</p>
        <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">If you are in any school social media groups, please share the message below.</p>
        <div style="margin:18px 0 10px;font-size:13px;font-weight:700;letter-spacing:0.04em;color:#166534;">SHARE THIS MESSAGE WITH OTHER PARENTS</div>
        <div style="margin:0 0 18px;padding:18px;background:#f0fdf4;border:1px solid #86efac;border-radius:12px;">
          <div style="white-space:pre-line;color:#14532d;font-size:15px;line-height:1.7;">I have joined Community Carpool, a free platform that helps parents find school carpool matches based on their routes.

The more parents from ${schoolName} who join, the better the matches get.

It takes just 1 minute to add your route:
${PROD_REF_URL}</div>
        </div>
        ${buildShareButtons(schoolName)}
        <p style="margin:20px 0 0;color:#374151;font-size:15px;line-height:1.7;">Thanks for helping grow the carpool community at your school.</p>
        <p style="margin:16px 0 0;color:#374151;font-size:15px;line-height:1.7;">Best,<br/>Community Carpool</p>
      </div>
    </div>
  </body></html>`
}

// Records which provider actually sent, rather than assuming Resend.
async function currentProvider(): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', 'email_service').single()
  return data?.value || 'resend'
}

// Routes through the shared sender so this follows the `email_service` config
// key. Returns the same { ok, body } shape the caller already destructures.
async function sendEmail(to: string, subject: string, html: string, schoolName: string) {
  let ok = true
  let messageId: string | null = null
  let errorMessage: string | null = null
  try {
    messageId = await sendViaProvider(to, subject, html)
  } catch (e: any) {
    ok = false
    errorMessage = e.message
    console.error(`[school-share-batch] send failed for ${to}:`, e.message)
  }

  await supabase.from('email_events').insert({
    event_type: ok ? 'email.sent' : 'email.failed',
    message_id: messageId,
    provider: await currentProvider(),
    recipient: to.toLowerCase(),
    batch_id: 'school-share-prod-batch',
    raw_payload: {
      subject,
      school_name: schoolName,
      school_share: true,
      referral_url: PROD_REF_URL,
      ...(errorMessage ? { error: errorMessage } : {})
    },
    occurred_at: new Date().toISOString()
  })

  return { ok, body: { id: messageId } }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get('limit') || '3')
  const offset = Number(url.searchParams.get('offset') || '0')

  const { data: submissions, error } = await supabase
    .from('submissions')
    .select('submission_id, user_id, from_location, to_location, journey_status, users!inner(email, name)')
    .eq('journey_status', 'active')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { headers: { 'Content-Type': 'application/json' }, status: 500 })
  }

  const schoolSubs = (submissions || []).filter((row: any) => {
    const schoolName = pickSchoolName(row.from_location, row.to_location)
    return (hasSchoolKeyword(row.from_location) || hasSchoolKeyword(row.to_location)) && !isFalsePositiveSchool(schoolName)
  })

  const targetSubs = schoolSubs.slice(offset, offset + limit)
  const results = []

  for (const row of targetSubs) {
    const firstName = (row.users?.name || 'there').split(' ')[0]
    const schoolName = pickSchoolName(row.from_location, row.to_location)
    const subject = `Please share Community Carpool with other parents at ${schoolName}`
    const html = buildEmail(firstName, schoolName)
    const sendResult = await sendEmail(row.users.email, subject, html, schoolName)
    results.push({
      submission_id: row.submission_id,
      email: row.users.email,
      name: row.users.name,
      school_name: schoolName,
      success: sendResult.ok,
      resend_id: sendResult.body?.id || null,
    })
  }

  return new Response(JSON.stringify({
    success: true,
    offset,
    sent: results.length,
    results,
  }), { headers: { 'Content-Type': 'application/json' } })
})
