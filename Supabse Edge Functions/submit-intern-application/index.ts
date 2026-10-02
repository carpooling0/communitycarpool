import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/send-email.ts'
import { escapeHtml, cleanText, clientIp, rateLimit, logSecurityEvent, isValidEmail } from '../_shared/security.ts'

// Fall back to the auto-injected vars so the module still boots if the
// DB_URL / DB_SERVICE_KEY vault secrets are ever absent. createClient throws
// at module scope on a falsy url or key, which would take the whole function down.
const supabase = createClient(
  Deno.env.get('DB_URL') || Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('DB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Where new applications are announced. Unchanged from the previous Resend call,
// so notifications keep landing in the same inbox after this migration.
const NOTIFY_EMAIL = 'carpooling0@gmail.com'

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function ratingBar(value: number | null | undefined): string {
  if (value == null) return '<span style="color:#9ca3af;">Not answered</span>'
  const filled = Math.max(0, Math.min(5, value))
  const dots = Array.from({ length: 5 }, (_, i) =>
    `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${i < filled ? '#16a34a' : '#d1fae5'};margin-right:3px;"></span>`
  ).join('')
  return `${dots} <span style="color:#374151;font-size:13px;margin-left:4px;">${filled}/5</span>`
}

// Pre-built, already-safe HTML (for example a link we constructed ourselves). Everything else
// passed to field() is treated as untrusted applicant text and escaped.
class SafeHtml { constructor(public html: string) {} }

function listField(value: string[] | null | undefined): string {
  if (!value || value.length === 0) return '<span style="color:#9ca3af;">None</span>'
  return value.map(v => escapeHtml(v)).join(', ')
}

function field(label: string, value: string | number | SafeHtml | null | undefined, type: 'text' | 'rating' | 'list' | 'textarea' = 'text'): string {
  let renderedValue: string
  if (type === 'rating') {
    renderedValue = ratingBar(value as number | null | undefined)
  } else if (type === 'list') {
    renderedValue = listField(value as string[] | null | undefined)
  } else if (type === 'textarea') {
    const text = value ? escapeHtml(value instanceof SafeHtml ? value.html : String(value)).replace(/\n/g, '<br>') : '<span style="color:#9ca3af;">Not answered</span>'
    renderedValue = `<div style="color:#374151;font-size:14px;line-height:1.6;white-space:pre-wrap;">${text}</div>`
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;vertical-align:top;">
          <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">${label}</div>
          ${renderedValue}
        </td>
      </tr>`
  } else {
    renderedValue = value != null && value !== ''
      ? `<span style="color:#111827;">${value instanceof SafeHtml ? value.html : escapeHtml(String(value))}</span>`
      : '<span style="color:#9ca3af;">Not provided</span>'
  }
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:13px;font-weight:600;color:#6b7280;width:45%;vertical-align:top;padding-right:12px;">${label}</td>
          <td style="font-size:14px;color:#111827;vertical-align:top;">${renderedValue}</td>
        </tr></table>
      </td>
    </tr>`
}

function sectionHeader(title: string, color = '#16a34a'): string {
  return `
    <tr>
      <td style="padding:20px 0 6px;">
        <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid ${color};padding-bottom:4px;">${title}</div>
      </td>
    </tr>`
}

function buildNotificationEmail(app: Record<string, any>, resumeLink: string | null): string {
  const submittedAt = new Date(app.submitted_at || Date.now()).toLocaleString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai'
  })

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>New Intern Application</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,system-ui,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:32px 16px;">

  <!-- Header -->
  <div style="background:#16a34a;border-radius:12px 12px 0 0;padding:24px 32px;">
    <div style="font-size:11px;font-weight:700;color:#bbf7d0;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Community Carpool</div>
    <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">New Intern Application</h1>
    <p style="margin:6px 0 0;color:#d1fae5;font-size:13px;">${submittedAt} (Dubai time)</p>
  </div>

  <!-- Body -->
  <div style="background:white;border-radius:0 0 12px 12px;padding:28px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <table width="100%" cellpadding="0" cellspacing="0">

      ${sectionHeader('Applicant')}
      ${field('Full Name', app.full_name)}
      ${field('Email', app.email)}
      ${field('Phone', app.phone)}
      ${field('City / Country', app.city_country)}
      ${app.linkedin && /^https?:\/\//i.test(app.linkedin) ? field('LinkedIn', new SafeHtml(`<a href="${escapeHtml(app.linkedin)}" style="color:#16a34a;">${escapeHtml(app.linkedin)}</a>`)) : (app.linkedin ? field('LinkedIn', app.linkedin) : '')}
      ${resumeLink ? field('Resume', new SafeHtml(`<a href="${escapeHtml(resumeLink)}" style="color:#16a34a;">Download Resume</a> <span style="color:#9ca3af;font-size:12px;">(link valid for 30 days)</span>`)) : ''}

      ${sectionHeader('Background', '#0369a1')}
      ${field('School / University', app.school)}
      ${field('Current Status', app.current_status)}
      ${field('Primary Interest', app.primary_interest)}

      ${sectionHeader('Availability', '#7c3aed')}
      ${field('Hours per Week', app.hours_per_week)}
      ${field('Availability', app.availability)}
      ${field('Preferred Times', app.preferred_times)}

      ${sectionHeader('Areas of Interest', '#b45309')}
      ${field('Areas', app.areas_of_interest, 'list')}

      ${sectionHeader('Scenario Responses', '#dc2626')}
      ${field('Scenario Reply', app.scenario_reply, 'textarea')}
      ${field('Scenario Approach', app.scenario_approach, 'textarea')}
      ${field('Scenario Follow-up', app.scenario_followup, 'textarea')}

      ${sectionHeader('Skills & Self-Assessment', '#0f766e')}
      ${field('Prior Experience', app.prior_experience, 'list')}
      ${field('Comfort: Writing', app.comfort_writing, 'rating')}
      ${field('Comfort: Talking to Strangers', app.comfort_strangers, 'rating')}
      ${field('Comfort: Repetitive Tasks', app.comfort_repetitive_tasks, 'rating')}
      ${field('OK with Repetitive Work?', app.ok_with_repetitive, 'textarea')}

      ${sectionHeader('Motivation', '#6d28d9')}
      ${field('Motivation', app.motivation, 'textarea')}

    </table>
  </div>

  <!-- Footer -->
  <div style="text-align:center;margin-top:20px;color:#9ca3af;font-size:12px;">
    <p style="margin:0;">Community Carpool &middot; communitycarpool.org</p>
    <p style="margin:4px 0 0;">Application ID: ${app.id}</p>
  </div>

</div>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Parse body
    let body: Record<string, any>
    try {
      body = await req.json()
    } catch {
      return json({ success: false, error: 'Invalid JSON body.' }, 400)
    }

    const ip = clientIp(req)

    // ── Step 1 of a resume upload: hand out a one-time signed upload URL ─────────
    // The bucket is private and has no public write policy. The file name is random (never the
    // applicant's own), and uploads are limited per IP so storage cannot be filled.
    if (body.action === 'create_upload') {
      if (ip !== 'unknown') {
        const h = await rateLimit(supabase, `resume:ip:${ip}:h`, 3600, 3)
        const d = await rateLimit(supabase, `resume:ip:${ip}:d`, 86400, 10)
        if (!h.allowed || !d.allowed) {
          await logSecurityEvent(supabase, 'resume_upload_rate_limited', ip, null, {})
          return json({ success: false, error: 'Too many uploads. Please try again later.' }, 429)
        }
      }
      const ext = String(body.filename || '').toLowerCase().match(/\.(pdf|docx?)$/)?.[1]
      if (!ext) return json({ success: false, error: 'Please upload a PDF or Word document.' }, 400)
      const path = `${crypto.randomUUID()}.${ext}`
      const { data, error } = await supabase.storage.from('intern-resumes').createSignedUploadUrl(path)
      if (error || !data) { console.error('createSignedUploadUrl failed:', error?.message); return json({ success: false, error: 'Upload is unavailable right now.' }, 500) }
      return json({ success: true, path, signedUrl: data.signedUrl })
    }

    const {
      full_name, email, phone, city_country,
      school, current_status, linkedin, resume_path,
      hours_per_week, availability, preferred_times,
      areas_of_interest, scenario_reply, scenario_approach, scenario_followup,
      prior_experience, comfort_writing, comfort_strangers, comfort_repetitive_tasks,
      ok_with_repetitive, motivation, primary_interest,
      _hp, _load_ms,
    } = body

    // ── Bot protection ────────────────────────────────────────────────────────
    // 1. Honeypot: hidden field that only bots fill
    if (_hp && String(_hp).trim().length > 0) {
      console.warn('[bot] Honeypot triggered — silently discarding submission')
      return json({ success: true }) // silent discard
    }
    // 2. Time gate: real humans take at least 5 seconds to fill a 6-step form
    if (typeof _load_ms === 'number' && _load_ms < 5000) {
      console.warn(`[bot] Form submitted in ${_load_ms}ms — silently discarding`)
      return json({ success: true }) // silent discard
    }

    // ── Validate required fields ──────────────────────────────────────────────
    if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
      return json({ success: false, error: 'full_name is required.' }, 400)
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return json({ success: false, error: 'email is required.' }, 400)
    }
    if (!isValidEmail(email.trim())) {
      return json({ success: false, error: 'email is not valid.' }, 400)
    }

    // Per-IP and per-address limits keep the form from being used to flood the support inbox
    if (ip !== 'unknown') {
      const h = await rateLimit(supabase, `intern:ip:${ip}:h`, 3600, 5)
      const d = await rateLimit(supabase, `intern:ip:${ip}:d`, 86400, 15)
      if (!h.allowed || !d.allowed) {
        await logSecurityEvent(supabase, 'intern_rate_limited', ip, email, {})
        return json({ success: false, error: 'Too many submissions. Please try again later.' }, 429)
      }
    }
    const perAddr = await rateLimit(supabase, `intern:email:${email.trim().toLowerCase()}`, 86400, 3)
    if (!perAddr.allowed) return json({ success: false, error: 'This email has already submitted recently.' }, 429)

    // A resume is referenced by storage path only (issued by create_upload), never a URL
    const resumePath = typeof resume_path === 'string' && /^[0-9a-f-]{36}\.(pdf|docx?)$/.test(resume_path) ? resume_path : null
    const txt = (v: unknown, n: number) => (v ? cleanText(v, n) : null)
    const list = (v: unknown) => Array.isArray(v) ? v.slice(0, 20).map(x => cleanText(x, 100)) : []

    // Insert into DB
    const { data: inserted, error: insertError } = await supabase
      .from('intern_applications')
      .insert({
        full_name: cleanText(full_name, 100),
        email: email.trim().toLowerCase(),
        phone: txt(phone, 40),
        city_country: txt(city_country, 100),
        school: txt(school, 150),
        current_status: txt(current_status, 100),
        linkedin: txt(linkedin, 300),
        resume_url: resumePath ? `intern-resumes/${resumePath}` : null,
        hours_per_week: txt(hours_per_week, 50),
        availability: txt(availability, 200),
        preferred_times: txt(preferred_times, 200),
        areas_of_interest: list(areas_of_interest),
        scenario_reply: scenario_reply ? String(scenario_reply).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, ' ').slice(0, 3000) : null,
        scenario_approach: scenario_approach ? String(scenario_approach).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, ' ').slice(0, 3000) : null,
        scenario_followup: scenario_followup ? String(scenario_followup).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, ' ').slice(0, 3000) : null,
        prior_experience: list(prior_experience),
        comfort_writing: typeof comfort_writing === 'number' ? comfort_writing : null,
        comfort_strangers: typeof comfort_strangers === 'number' ? comfort_strangers : null,
        comfort_repetitive_tasks: typeof comfort_repetitive_tasks === 'number' ? comfort_repetitive_tasks : null,
        ok_with_repetitive: txt(ok_with_repetitive, 100),
        motivation: motivation ? String(motivation).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, ' ').slice(0, 3000) : null,
        primary_interest: txt(primary_interest, 150),
      })
      .select()
      .single()

    if (insertError) {
      console.error('intern_applications insert error:', insertError)
      throw new Error(`Database error: ${insertError.message}`)
    }

    // Send the notification through the shared sender so it follows the
    // `email_service` config key (prod runs on SES) rather than hardcoding
    // Resend. A failure is logged but never fails the request: the application
    // is already saved.
    try {
      let resumeLink: string | null = null
      if (resumePath) {
        const { data: signed } = await supabase.storage.from('intern-resumes').createSignedUrl(resumePath, 60 * 60 * 24 * 30)
        resumeLink = signed?.signedUrl || null
      }
      await sendEmail(
        NOTIFY_EMAIL,
        `New Intern Application \u2014 ${String(inserted.full_name).replace(/[\r\n]/g, ' ')}`,
        buildNotificationEmail(inserted, resumeLink)
      )
      console.log(`Intern application notification sent for ID ${inserted.id}`)
    } catch (e: any) {
      console.error(`[submit-intern-application] Notification failed for ID ${inserted.id}:`, e.message)
    }

    return json({ success: true, id: inserted.id })

  } catch (err: any) {
    console.error('submit-intern-application error:', err)
    return json({ success: false, error: 'Something went wrong. Please try again.' }, 500)
  }
})
