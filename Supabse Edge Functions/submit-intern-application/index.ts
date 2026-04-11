import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('DB_URL')!,
  Deno.env.get('DB_SERVICE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

function listField(value: string[] | null | undefined): string {
  if (!value || value.length === 0) return '<span style="color:#9ca3af;">None</span>'
  return value.join(', ')
}

function field(label: string, value: string | number | null | undefined, type: 'text' | 'rating' | 'list' | 'textarea' = 'text'): string {
  let renderedValue: string
  if (type === 'rating') {
    renderedValue = ratingBar(value as number | null | undefined)
  } else if (type === 'list') {
    renderedValue = listField(value as string[] | null | undefined)
  } else if (type === 'textarea') {
    const text = value ? String(value).replace(/\n/g, '<br>') : '<span style="color:#9ca3af;">Not answered</span>'
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
      ? `<span style="color:#111827;">${String(value)}</span>`
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

function buildNotificationEmail(app: Record<string, any>): string {
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

    const {
      full_name, email, phone, city_country,
      school, current_status, hours_per_week, availability, preferred_times,
      areas_of_interest, scenario_reply, scenario_approach, scenario_followup,
      prior_experience, comfort_writing, comfort_strangers, comfort_repetitive_tasks,
      ok_with_repetitive, motivation, primary_interest,
    } = body

    // Validate required fields
    if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
      return json({ success: false, error: 'full_name is required.' }, 400)
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return json({ success: false, error: 'email is required.' }, 400)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return json({ success: false, error: 'email is not valid.' }, 400)
    }

    // Insert into DB
    const { data: inserted, error: insertError } = await supabase
      .from('intern_applications')
      .insert({
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone || null,
        city_country: city_country || null,
        school: school || null,
        current_status: current_status || null,
        hours_per_week: hours_per_week || null,
        availability: availability || null,
        preferred_times: preferred_times || null,
        areas_of_interest: Array.isArray(areas_of_interest) ? areas_of_interest : [],
        scenario_reply: scenario_reply || null,
        scenario_approach: scenario_approach || null,
        scenario_followup: scenario_followup || null,
        prior_experience: Array.isArray(prior_experience) ? prior_experience : [],
        comfort_writing: typeof comfort_writing === 'number' ? comfort_writing : null,
        comfort_strangers: typeof comfort_strangers === 'number' ? comfort_strangers : null,
        comfort_repetitive_tasks: typeof comfort_repetitive_tasks === 'number' ? comfort_repetitive_tasks : null,
        ok_with_repetitive: ok_with_repetitive || null,
        motivation: motivation || null,
        primary_interest: primary_interest || null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('intern_applications insert error:', insertError)
      throw new Error(`Database error: ${insertError.message}`)
    }

    // Send notification email via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'noreply@communitycarpool.org'

    if (resendKey) {
      const html = buildNotificationEmail(inserted)
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Community Carpool <${fromEmail}>`,
          to: ['carpooling0@gmail.com'],
          subject: `New Intern Application \u2014 ${inserted.full_name}`,
          html,
        }),
      })
      if (!emailRes.ok) {
        // Log but don't fail the request — the application is already saved
        console.error(`Resend notification failed ${emailRes.status}: ${await emailRes.text()}`)
      } else {
        console.log(`Intern application notification sent for ID ${inserted.id}`)
      }
    } else {
      console.warn('RESEND_API_KEY not set — notification email skipped')
    }

    return json({ success: true, id: inserted.id })

  } catch (err: any) {
    console.error('submit-intern-application error:', err)
    return json({ success: false, error: err.message }, 500)
  }
})
