// ── submit-partner-enquiry ───────────────────────────────────────────────────
// Stores enquiries from partners.html in `partner_enquiries` and notifies admin.
//
// Uses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected in both envs)
// rather than the DB_URL / DB_SERVICE_KEY vault secrets, which are not set in
// prod. Email goes through _shared/send-email.ts so it follows the
// `email_service` config key instead of hardcoding a provider.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/send-email.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ORG_TYPES = ['school', 'corporate', 'residential', 'other']

// Notifications follow the `support_notify_email` config row, same as
// submit-support-ticket / confirm-deletion / process-deletions, so the inbox can
// be moved with one SQL update and no redeploy. The constant is only a safety net
// for an environment where that row is missing — without it a missing row would
// silently drop the notification.
const NOTIFY_FALLBACK = 'carpooling0@gmail.com'

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

function clip(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

const TYPE_LABEL: Record<string, string> = {
  school:      'School',
  corporate:   'Corporate / employer',
  residential: 'Residential community',
  other:       'Other',
}

function buildNotificationEmail(row: any): string {
  const rows = [
    ['Name',         row.contact_name],
    ['Work email',   row.work_email],
    ['Organisation', row.organisation],
    ['Type',         TYPE_LABEL[row.org_type] || row.org_type],
    ['IP address',   row.ip_address],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600;color:#6b7280;width:38%;vertical-align:top;">${k}</td>
        <td style="padding:9px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#111827;vertical-align:top;">${escapeHtml(String(v))}</td>
      </tr>`)
    .join('')

  const messageBlock = row.message
    ? `<div style="margin-top:22px;">
         <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Message</div>
         <div style="font-size:14px;color:#374151;line-height:1.65;white-space:pre-wrap;">${escapeHtml(row.message)}</div>
       </div>`
    : ''

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
      <div style="background:#ffffff;border-radius:16px;padding:32px;">
        <h2 style="color:#1B5C3A;margin:0 0 4px;font-size:20px;">New Partner Enquiry #${row.id}</h2>
        <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">${escapeHtml(row.organisation || 'Organisation not given')}</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        ${messageBlock}
      </div>
    </div></body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    let body: any
    try {
      body = await req.json()
    } catch {
      return json({ success: false, error: 'Invalid JSON body.' }, 400)
    }

    const { contact_name, work_email, organisation, org_type, message, _hp, _load_ms } = body

    // ── Bot protection (same approach as submit-intern-application) ───────────
    if (_hp && String(_hp).trim().length > 0) {
      console.warn('[bot] Honeypot triggered — silently discarding enquiry')
      return json({ success: true })
    }
    if (typeof _load_ms === 'number' && _load_ms < 3000) {
      console.warn(`[bot] Form submitted in ${_load_ms}ms — silently discarding enquiry`)
      return json({ success: true })
    }

    // ── Validate ──────────────────────────────────────────────────────────────
    const name  = clip(contact_name, 120)
    const email = clip(work_email, 200)
    if (!name)  return json({ success: false, error: 'Your name is required.' }, 400)
    if (!email) return json({ success: false, error: 'A work email is required.' }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, error: 'That email address is not valid.' }, 400)
    }

    const type = typeof org_type === 'string' && ORG_TYPES.includes(org_type) ? org_type : null

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('cf-connecting-ip') ||
      null

    // ── Store ─────────────────────────────────────────────────────────────────
    const { data: row, error: insertError } = await supabase
      .from('partner_enquiries')
      .insert({
        contact_name: name,
        work_email:   email.toLowerCase(),
        organisation: clip(organisation, 200),
        org_type:     type,
        message:      clip(message, 4000),
        ip_address:   ip,
      })
      .select()
      .single()

    if (insertError) {
      console.error('partner_enquiries insert error:', insertError)
      throw new Error(`Database error: ${insertError.message}`)
    }

    // ── Notify admin. Awaited so the isolate cannot be torn down mid-send, but
    //    a failure never fails the request: the enquiry is already stored.
    try {
      const configured = await getConfig('support_notify_email')
      if (!configured) {
        console.warn(`[submit-partner-enquiry] support_notify_email row missing — falling back to ${NOTIFY_FALLBACK}`)
      }
      await sendEmail(
        configured || NOTIFY_FALLBACK,
        `New Partner Enquiry — ${row.organisation || row.contact_name}`,
        buildNotificationEmail(row)
      )
      console.log(`Partner enquiry notification sent for ID ${row.id}`)
    } catch (e: any) {
      console.error(`[submit-partner-enquiry] Notification failed for enquiry ${row.id}:`, e.message)
    }

    return json({ success: true, id: row.id })

  } catch (err: any) {
    console.error('submit-partner-enquiry error:', err)
    return json({ success: false, error: err.message }, 500)
  }
})
