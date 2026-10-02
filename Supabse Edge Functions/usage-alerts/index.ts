// ── Usage and abuse alerts ───────────────────────────────────────────────────
// Runs hourly from pg_cron and emails support_notify_email when something is heading
// toward a free-tier limit or looks like abuse. Each alert fires once per period
// (deduplicated with rate_limit_hit), so a problem produces one email, not one per hour.
//
//   Mapbox requests     50% / 80% / 100% of mapbox_monthly_limit        (once a month each)
//   Database size       70% / 85% of the 500 MB free limit               (once a week each)
//   File storage        50% / 80% of the 1 GB free limit                 (once a week each)
//   Match emails        more than alert_match_emails_per_day in 24 hours (once a day)
//   Sign-up bursts      one IP above alert_signups_per_ip_per_hour       (once an hour per IP)
//   Admin security      locked-out logins or blocked admin IPs           (once an hour)
//
// Edge function invocations cannot be read from inside a function: watch the Usage page.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/send-email.ts'
import { requireInternal, rateLimit, getConfigNumber, escapeHtml } from '../_shared/security.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)

const MB = 1024 * 1024
const DB_LIMIT_BYTES = 500 * MB      // Supabase Free plan
const STORAGE_LIMIT_BYTES = 1024 * MB

const json = (data: object, status = 200) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' }, status })

Deno.serve(async (req) => {
  const denied = await requireInternal(req, supabase, 'usage-alerts')
  if (denied) return denied

  try {
    const alerts: { title: string; detail: string }[] = []
    // fire once per `windowSeconds` for this key
    const once = async (key: string, windowSeconds: number) => (await rateLimit(supabase, `alert:${key}`, windowSeconds, 1)).allowed

    // ── Mapbox ─────────────────────────────────────────────────────────────
    const month = new Date().toISOString().slice(0, 7)
    const mapboxLimit = await getConfigNumber(supabase, 'mapbox_monthly_limit', 80000)
    const { data: mu } = await supabase.from('mapbox_usage').select('request_count').eq('month', month).maybeSingle()
    const used = mu?.request_count || 0
    for (const pct of [100, 80, 50]) {
      if (mapboxLimit > 0 && used >= mapboxLimit * pct / 100) {
        if (await once(`mapbox:${pct}:${month}`, 35 * 86400)) {
          alerts.push({ title: `Mapbox usage at ${pct}% of the monthly cap`, detail: `${used.toLocaleString()} of ${mapboxLimit.toLocaleString()} requests used in ${month}. At 100% distance checks switch to straight-line (haversine) until next month.` })
        }
        break   // only the highest threshold reached
      }
    }

    // ── Database size and storage ──────────────────────────────────────────
    const { data: dbBytes } = await supabase.rpc('db_size_bytes')
    if (typeof dbBytes === 'number') {
      for (const pct of [85, 70]) {
        if (dbBytes >= DB_LIMIT_BYTES * pct / 100) {
          if (await once(`db:${pct}`, 7 * 86400)) alerts.push({ title: `Database at ${pct}% of the free 500 MB limit`, detail: `Currently ${(dbBytes / MB).toFixed(0)} MB. Look at the largest tables (events, matches, net._http_response, cron.job_run_details).` })
          break
        }
      }
    }
    const { data: stBytes } = await supabase.rpc('storage_bytes')
    if (typeof stBytes === 'number') {
      for (const pct of [80, 50]) {
        if (stBytes >= STORAGE_LIMIT_BYTES * pct / 100) {
          if (await once(`storage:${pct}`, 7 * 86400)) alerts.push({ title: `File storage at ${pct}% of the free 1 GB limit`, detail: `Currently ${(stBytes / MB).toFixed(0)} MB, almost all in the intern-resumes bucket. Check for unusual uploads.` })
          break
        }
      }
    }

    // ── Email volume ───────────────────────────────────────────────────────
    const emailCap = await getConfigNumber(supabase, 'alert_match_emails_per_day', 1500)
    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count: sent24h } = await supabase.from('events').select('*', { count: 'exact', head: true })
      .eq('event_type', 'match_email_sent').gte('created_at', since24h)
    if ((sent24h || 0) > emailCap && await once('emails:day', 86400)) {
      alerts.push({ title: 'Unusually many match emails', detail: `${sent24h} match emails in the last 24 hours (alert level ${emailCap}). Check batch-send-emails runs and recent sign-up volume.` })
    }

    // ── Sign-up bursts from one IP ─────────────────────────────────────────
    const ipCap = await getConfigNumber(supabase, 'alert_signups_per_ip_per_hour', 25)
    const sinceHour = new Date(Date.now() - 3600 * 1000).toISOString()
    const { data: recent } = await supabase.from('submissions').select('ip').gte('created_at', sinceHour).limit(3000)
    const perIp: Record<string, number> = {}
    for (const r of recent || []) if (r.ip && r.ip !== 'unknown') perIp[r.ip] = (perIp[r.ip] || 0) + 1
    for (const [ip, n] of Object.entries(perIp)) {
      if (n > ipCap && await once(`signups:${ip}`, 3600)) {
        alerts.push({ title: 'Sign-up burst from one IP address', detail: `${n} journeys from ${escapeHtml(ip)} in the last hour (alert level ${ipCap}). Organisation client links are exempt from the per-IP limit, so check whether this is one of them.` })
      }
    }

    // ── Admin security signals ─────────────────────────────────────────────
    const { data: secEvents } = await supabase.from('security_events').select('event_type, ip')
      .in('event_type', ['admin_login_locked', 'admin_ip_blocked']).gte('created_at', sinceHour).limit(200)
    if ((secEvents?.length || 0) > 0 && await once('admin-security', 3600)) {
      const ips = [...new Set((secEvents || []).map(e => e.ip).filter(Boolean))].slice(0, 5).map(escapeHtml).join(', ')
      alerts.push({ title: 'Admin login protection triggered', detail: `${secEvents!.length} locked-out or IP-blocked admin attempts in the last hour. Source IPs: ${ips || 'unknown'}.` })
    }

    if (alerts.length > 0) {
      const to = (await supabase.from('config').select('value').eq('key', 'support_notify_email').single()).data?.value
      if (to) {
        const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:620px;padding:20px;color:#111827">
          <h2 style="margin:0 0 14px;color:#b45309">Community Carpool: ${alerts.length} alert${alerts.length > 1 ? 's' : ''}</h2>
          ${alerts.map(a => `<div style="border-left:4px solid #f59e0b;background:#fffbeb;padding:10px 14px;margin:0 0 12px;border-radius:4px"><strong>${escapeHtml(a.title)}</strong><br><span style="font-size:14px;color:#374151">${a.detail}</span></div>`).join('')}
          <p style="font-size:12px;color:#9ca3af">Sent by the hourly usage-alerts job. Each alert is sent once per period.</p></div>`
        await sendEmail(to, `[Community Carpool alert] ${alerts[0].title}${alerts.length > 1 ? ` (+${alerts.length - 1} more)` : ''}`, html)
      }
    }
    return json({ success: true, alerts: alerts.map(a => a.title), mapboxUsed: used, dbMB: typeof dbBytes === 'number' ? Math.round(dbBytes / MB) : null })
  } catch (err: any) {
    console.error('usage-alerts error:', err)
    return json({ success: false, error: 'Alert check failed' }, 500)
  }
})
