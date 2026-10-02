import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { clientIp, rateLimit, logSecurityEvent, getConfigNumber, timingSafeEqual, runInBackground } from '../_shared/security.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

const json = (data: object, status = 200) =>
  new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status })

// ── What happens once an email address is proven ─────────────────────────────
//  1. mark the journey verified and clear the PIN / link token / client secret
//  2. copy the name and terms version typed on the form onto the user record
//     (held back until now so a stranger cannot rename someone else's account)
//  3. start matching, which submit-journey deliberately skipped until now
async function completeEmailVerification(submissionId: number, method: 'pin' | 'link') {
  await supabase.from('submissions').update({
    email_verification_status: 'email_verified',
    email_verification_pin: null,
    email_verification_token: null,
    client_verify_secret: null,
  }).eq('submission_id', submissionId)

  await supabase.from('events').insert({
    event_type: 'email_verified', submission_id: submissionId, metadata: { method }
  })

  const { data: sub } = await supabase.from('submissions')
    .select('user_id, submitted_name, submitted_terms_version').eq('submission_id', submissionId).single()
  if (sub?.submitted_name) {
    await supabase.from('users').update({
      name: sub.submitted_name,
      terms_accepted_version: sub.submitted_terms_version,
      terms_accepted_at: new Date().toISOString(),
    }).eq('user_id', sub.user_id)
  }

  const { data: mode } = await supabase.from('config').select('value').eq('key', 'matching_mode').single()
  if (mode?.value === 'hybrid' || mode?.value === 'instant') {
    runInBackground(fetch(`${Deno.env.get('DB_URL')}/functions/v1/find-matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('DB_SERVICE_KEY')}` },
      body: JSON.stringify({ submissionId }),
      signal: AbortSignal.timeout(60000),
    }))
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ip = clientIp(req)
    const url = new URL(req.url)
    const token = url.searchParams.get('token')

    // Every request, successful or not, counts against a per-IP budget
    if (ip !== 'unknown') {
      const rl = await rateLimit(supabase, `verify:ip:${ip}`, 600, 40)
      if (!rl.allowed) {
        await logSecurityEvent(supabase, 'verify_ip_rate_limited', ip, null, {})
        return json({ success: false, error: 'Too many attempts. Please wait a few minutes and try again.' }, 429)
      }
    }

    // ── GET: verify by link token (clicked from email) ──────────────────────────
    if (req.method === 'GET' && token) {
      if (!/^[0-9a-fA-F-]{36}$/.test(token)) return json({ success: false, error: 'Invalid verification link.' }, 400)

      const { data: sub } = await supabase
        .from('submissions')
        .select('submission_id, user_id, email_verification_status, email_verification_pin_expires_at, journey_num, distance_km')
        .eq('email_verification_token', token)
        .single()

      if (!sub) return json({ success: false, error: 'Invalid verification link.' }, 400)

      if (sub.email_verification_status === 'email_verified')
        return json({ success: true, alreadyVerified: true, submissionId: sub.submission_id, journeyNum: sub.journey_num, actualDist: sub.distance_km })

      if (new Date(sub.email_verification_pin_expires_at) < new Date())
        return json({ success: false, error: 'This verification link has expired. Please request a new code.' }, 400)

      await completeEmailVerification(sub.submission_id, 'link')
      return json({ success: true, submissionId: sub.submission_id, journeyNum: sub.journey_num, actualDist: sub.distance_km })
    }

    // ── POST: verify by PIN (entered in the modal) ──────────────────────────────
    const { submissionId, pin, channel = 'email', clientSecret } = await req.json()

    const subId = Number(submissionId)
    if (!Number.isInteger(subId) || subId <= 0 || typeof pin !== 'string' || !/^\d{6}$/.test(pin) ||
        typeof clientSecret !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(clientSecret))
      return json({ success: false, error: 'Please enter the 6-digit code.' }, 400)

    const { data: sub } = await supabase
      .from('submissions')
      .select(`submission_id, user_id, journey_num, distance_km, client_verify_secret,
               email_verification_status, email_verification_pin, email_verification_pin_expires_at,
               whatsapp_verification_status, whatsapp_verification_pin, whatsapp_verification_pin_expires_at`)
      .eq('submission_id', subId)
      .single()

    // Unknown submission and wrong secret look identical, so ids cannot be probed.
    // Only the browser that created the journey knows the secret.
    if (!sub || !sub.client_verify_secret || !timingSafeEqual(sub.client_verify_secret, clientSecret.toLowerCase())) {
      await logSecurityEvent(supabase, 'verify_bad_secret', ip, String(subId), {})
      return json({ success: false, error: 'This verification request is not valid. Please request a new code.' }, 400)
    }

    const maxAttempts = await getConfigNumber(supabase, 'pin_max_wrong_attempts', 5)
    const isWa = channel === 'whatsapp'

    // ── WhatsApp channel ─────────────────────────────────────────────────────
    if (isWa) {
      if (sub.whatsapp_verification_status === 'whatsapp_verified') return json({ success: true, alreadyVerified: true })
      if (!sub.whatsapp_verification_pin) return json({ success: false, error: 'No code found. Please request a new one.' }, 400)
      if (new Date(sub.whatsapp_verification_pin_expires_at) < new Date()) return json({ success: false, error: 'The code has expired. Please request a new one.' }, 400)

      const used = await supabase.rpc('consume_pin_attempt', { p_submission_id: subId, p_channel: 'whatsapp', p_max: maxAttempts })
      const attempts = Number(used.data ?? 0)
      if (attempts > maxAttempts) {
        await logSecurityEvent(supabase, 'pin_locked', ip, String(subId), { channel: 'whatsapp' })
        return json({ success: false, locked: true, error: 'Too many incorrect attempts. Please request a new code.' }, 429)
      }
      if (!timingSafeEqual(sub.whatsapp_verification_pin, pin))
        return json({ success: false, error: `Incorrect code. ${Math.max(0, maxAttempts - attempts)} attempt(s) left.` }, 400)

      await supabase.from('submissions').update({ whatsapp_verification_status: 'whatsapp_verified', whatsapp_verification_pin: null }).eq('submission_id', subId)
      await supabase.from('events').insert({ event_type: 'whatsapp_verified', submission_id: subId, metadata: { method: 'pin' } })
      return json({ success: true })
    }

    // ── Email channel (default) ──────────────────────────────────────────────
    if (sub.email_verification_status === 'email_verified') return json({ success: true, alreadyVerified: true })
    if (!sub.email_verification_pin) return json({ success: false, error: 'No code found. Please request a new one.' }, 400)
    if (new Date(sub.email_verification_pin_expires_at) < new Date()) return json({ success: false, error: 'The code has expired. Please request a new one.' }, 400)

    const used = await supabase.rpc('consume_pin_attempt', { p_submission_id: subId, p_channel: 'email', p_max: maxAttempts })
    const attempts = Number(used.data ?? 0)
    if (attempts > maxAttempts) {
      await logSecurityEvent(supabase, 'pin_locked', ip, String(subId), { channel: 'email' })
      return json({ success: false, locked: true, error: 'Too many incorrect attempts. Please request a new code.' }, 429)
    }
    if (!timingSafeEqual(sub.email_verification_pin, pin))
      return json({ success: false, error: `Incorrect code. ${Math.max(0, maxAttempts - attempts)} attempt(s) left.` }, 400)

    await completeEmailVerification(subId, 'pin')
    return json({ success: true })

  } catch (err: any) {
    console.error('verify-pin error:', err)
    return json({ success: false, error: 'Something went wrong. Please try again.' }, 500)
  }
})
