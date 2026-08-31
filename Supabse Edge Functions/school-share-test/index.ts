import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = 'https://communitycarpool.org'
const DEV_REF_URL = 'https://dev.communitycarpool.org?ref=021'

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

function pickSchoolName(fromLocation: string, toLocation: string): string {
  if (hasSchoolKeyword(toLocation)) return extractPoiName(toLocation)
  if (hasSchoolKeyword(fromLocation)) return extractPoiName(fromLocation)
  return 'your school'
}

function buildShareButtons(): string {
  const shareUrl = encodeURIComponent(SITE_URL)
  const shareText = encodeURIComponent(`I have joined Community Carpool, a free platform that helps parents find school carpool matches based on their routes.\n\nThe more parents from our school who join, the better the matches get.\n\nIt takes just 1 minute to add your route:\n${DEV_REF_URL}`)
  return `
    <div style="margin-top:18px;padding:16px 18px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;text-align:center;">
      <div style="font-size:15px;font-weight:700;color:#166534;margin-bottom:10px;">Or use the share buttons below to send it quickly.</div>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
        <td style="padding:0 6px;"><a href="https://wa.me/?text=${shareText}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2238%22%20height%3D%2238%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%2325d366%22%2F%3E%3Cpath%20d%3D%22M25.2%2010.7A10.5%2010.5%200%200%200%208.4%2025.8L7%2029l3.3-1.3a10.5%2010.5%200%201%200%2014.9-17zM18%2026.6a8.5%208.5%200%200%201-4.3-1.2l-.3-.2-2.5.7.7-2.4-.2-.4A8.5%208.5%200%201%201%2018%2026.6zm4.7-6.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.6.1l-.9%201.1c-.2.2-.3.2-.6.1-1.8-.9-3-2.6-3.2-2.9-.2-.3%200-.4.1-.5l.4-.5.3-.5c.1-.2.1-.4%200-.6l-.9-2.1c-.2-.5-.5-.4-.6-.4h-.5c-.2%200-.5.1-.8.4-.3.3-1%201-1%202.4s1%202.8%201.2%203c.1.2%202%203.1%204.9%204.4.7.3%201.2.5%201.6.6.7.2%201.3.2%201.8.1.6-.1%201.7-.7%202-1.4.2-.7.2-1.3.2-1.4 0-.1-.2-.2-.5-.3z%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E" width="38" height="38" alt="WhatsApp" /></a></td>
        <td style="padding:0 6px;"><a href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2238%22%20height%3D%2238%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%231877F2%22%2F%3E%3Cpath%20d%3D%22M20.7%2012.3h-1.8c-.2%200-.4.2-.4.5v1.6h2.1l-.3%202.1h-1.8V24h-2.2v-7.5h-1.8v-2.1h1.8v-1.9c0-1.8%201.1-2.9%202.8-2.9h2v2.1z%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E" width="38" height="38" alt="Facebook" /></a></td>
        <td style="padding:0 6px;"><a href="https://x.com/intent/tweet?text=${shareText}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2238%22%20height%3D%2238%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%23000000%22%2F%3E%3Cpath%20d%3D%22M22.9%209h2.6l-5.7%206.5L26.5%2027h-5.2l-4.1-5.4-4.7%205.4H9.9l6.1-7-6.5-11h5.3l3.7%204.9L22.9%209zm-1%2015.9h1.4L14%2010.9h-1.5z%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E" width="38" height="38" alt="X" /></a></td>
        <td style="padding:0 6px;"><a href="https://www.linkedin.com/shareArticle?mini=true&url=${shareUrl}&title=${encodeURIComponent('Community Carpool')}&summary=${encodeURIComponent('Free school carpool matching based on routes.')}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2238%22%20height%3D%2238%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%230A66C2%22%2F%3E%3Cpath%20d%3D%22M11.2%2014.4a1.8%201.8%200%201%201%200-3.6%201.8%201.8%200%200%201%200%203.6zM9.7%2016h3v10.3h-3zm4.9%200h2.9v1.4h.1c.4-.8%201.4-1.7%202.9-1.7%203.1%200%203.7%202%203.7%204.7v5.9h-3v-5.2c0-1.2%200-2.8-1.7-2.8s-2%201.3-2%202.7v5.3h-3z%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E" width="38" height="38" alt="LinkedIn" /></a></td>
        <td style="padding:0 6px;"><a href="sms:?body=${shareText}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2238%22%20height%3D%2238%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%2322c55e%22%2F%3E%3Cpath%20d%3D%22M9%2011a2%202%200%200%201%202-2h14a2%202%200%200%201%202%202v9a2%202%200%200%201-2%202h-5l-4%203v-3h-5a2%202%200%200%201-2-2v-9z%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E" width="38" height="38" alt="SMS" /></a></td>
      </tr></table>
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
${DEV_REF_URL}</div>
        </div>

        ${buildShareButtons()}

        <p style="margin:20px 0 0;color:#374151;font-size:15px;line-height:1.7;">Thanks for helping grow the carpool community at your school.</p>
        <p style="margin:16px 0 0;color:#374151;font-size:15px;line-height:1.7;">Best,<br/>Community Carpool</p>
      </div>
    </div>
  </body></html>`
}

async function sendEmail(to: string, subject: string, html: string, schoolName: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Community Carpool <${fromEmail}>`, to: [to], subject, html })
  })
  const body = await res.json()
  if (res.ok) {
    await supabase.from('email_events').insert({
      event_type: 'email.sent',
      message_id: body?.id || null,
      provider: 'resend',
      recipient: to.toLowerCase(),
      batch_id: 'school-share-test',
      raw_payload: {
        subject,
        school_name: schoolName,
        school_share: true,
        referral_url: DEV_REF_URL
      },
      occurred_at: new Date().toISOString()
    })
  }
  return { ok: res.ok, body }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const testTo = url.searchParams.get('test_to')

  const { data: submissions, error } = await supabase
    .from('submissions')
    .select('submission_id, user_id, from_location, to_location, journey_status, users!inner(email, name)')
    .eq('journey_status', 'active')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { headers: { 'Content-Type': 'application/json' }, status: 500 })
  }

  const schoolSubs = (submissions || []).filter((row: any) =>
    hasSchoolKeyword(row.from_location) || hasSchoolKeyword(row.to_location)
  )

  const sample = schoolSubs.slice(0, 10).map((row: any) => ({
    submission_id: row.submission_id,
    email: row.users?.email,
    from_location: row.from_location,
    to_location: row.to_location,
    school_name: pickSchoolName(row.from_location, row.to_location)
  }))

  if (!testTo) {
    return new Response(JSON.stringify({
      success: true,
      school_route_count: schoolSubs.length,
      unique_users: [...new Set(schoolSubs.map((row: any) => row.user_id))].length,
      sample
    }), { headers: { 'Content-Type': 'application/json' } })
  }

  const requested = schoolSubs.find((row: any) => row.users?.email?.toLowerCase() === testTo.toLowerCase()) || schoolSubs[0]
  if (!requested) {
    return new Response(JSON.stringify({ success: false, error: 'No school-route submissions found in dev' }), { headers: { 'Content-Type': 'application/json' }, status: 404 })
  }

  const firstName = (requested.users?.name || 'there').split(' ')[0]
  const schoolName = pickSchoolName(requested.from_location, requested.to_location)
  const html = buildEmail(firstName, schoolName)
  const sendResult = await sendEmail(testTo, `Please share Community Carpool with other parents at ${schoolName}`, html, schoolName)

  return new Response(JSON.stringify({
    success: sendResult.ok,
    to: testTo,
    school_name: schoolName,
    school_route_count: schoolSubs.length,
    unique_users: [...new Set(schoolSubs.map((row: any) => row.user_id))].length,
    resend: sendResult.body
  }), { headers: { 'Content-Type': 'application/json' }, status: sendResult.ok ? 200 : 500 })
})
