import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendResendPinEmail, sendWhatsAppPin } from '../_shared/pin-email.ts'
import { clientIp, rateLimit, logSecurityEvent, getConfigNumber, generatePin, timingSafeEqual } from '../_shared/security.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

const json = (data: object, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra }, status })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ip = clientIp(req)
    const { submissionId, channel = 'email', clientSecret } = await req.json()

    const subId = Number(submissionId)
    if (!Number.isInteger(subId) || subId <= 0 || typeof clientSecret !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(clientSecret))
      return json({ success: false, error: 'This request is not valid. Please start again.' }, 400)

    // Per-IP budget for resend requests
    if (ip !== 'unknown') {
      const rl = await rateLimit(supabase, `resend:ip:${ip}`, 3600, 20)
      if (!rl.allowed) {
        await logSecurityEvent(supabase, 'resend_ip_rate_limited', ip, String(subId), {})
        return json({ success: false, error: 'Too many requests. Please try again later.' }, 429, { 'Retry-After': String(rl.retryAfter) })
      }
    }

    // Fetch submission + user in one go via join
    const { data: sub } = await supabase
      .from('submissions')
      .select('submission_id, user_id, client_verify_secret, email_verification_status, whatsapp_number, whatsapp_verification_status, users(email, name)')
      .eq('submission_id', subId)
      .single()

    // Unknown id and wrong secret are indistinguishable. Without the secret held by the
    // browser that submitted the journey, nobody can trigger emails to or reset the PIN of
    // someone else's submission.
    if (!sub || !sub.client_verify_secret || !timingSafeEqual(sub.client_verify_secret, clientSecret.toLowerCase())) {
      await logSecurityEvent(supabase, 'resend_bad_secret', ip, String(subId), {})
      return json({ success: false, error: 'This request is not valid. Please start again.' }, 400)
    }

    // 30 second cooldown and an hourly cap per submission
    const cool = await rateLimit(supabase, `resend:cool:${subId}`, 30, 1)
    if (!cool.allowed) return json({ success: false, error: `Please wait ${cool.retryAfter} seconds before requesting another code.` }, 429, { 'Retry-After': String(cool.retryAfter) })
    const perSub = await rateLimit(supabase, `resend:sub:${subId}`, 3600, 5)
    if (!perSub.allowed) return json({ success: false, error: 'Too many codes requested for this journey. Please try again later.' }, 429, { 'Retry-After': String(perSub.retryAfter) })

    const user = sub.users as any
    const newPin = generatePin()
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    // ── WhatsApp resend ──────────────────────────────────────────────────────
    if (channel === 'whatsapp') {
      if (!sub.whatsapp_number) return json({ success: false, error: 'No WhatsApp number on record.' }, 400)

      await supabase.from('submissions').update({
        whatsapp_verification_pin: newPin,
        whatsapp_verification_pin_expires_at: expiry,
        whatsapp_verification_attempts: 0,
      }).eq('submission_id', subId)

      await sendWhatsAppPin(sub.whatsapp_number, newPin)
      await supabase.from('events').insert({ event_type: 'whatsapp_pin_resent', submission_id: subId, metadata: {} })
      return json({ success: true })
    }

    // ── Email resend (default) ───────────────────────────────────────────────
    if (sub.email_verification_status === 'email_verified') return json({ success: true, alreadyVerified: true })
    if (!user?.email) return json({ success: false, error: 'User not found.' }, 404)

    // Per-address budget shared with submit-journey, so one inbox cannot be flooded
    const perHour = await getConfigNumber(supabase, 'pin_max_emails_per_address_per_hour', 5)
    const perDay = await getConfigNumber(supabase, 'pin_max_emails_per_address_per_day', 12)
    const addr = String(user.email).toLowerCase()
    const h = await rateLimit(supabase, `pin:email:${addr}:h`, 3600, perHour)
    const d = await rateLimit(supabase, `pin:email:${addr}:d`, 86400, perDay)
    if (!h.allowed || !d.allowed) {
      await logSecurityEvent(supabase, 'pin_email_rate_limited', ip, addr, { via: 'resend' })
      return json({ success: false, error: 'Too many verification emails have been sent to this address. Please try again later.' }, 429)
    }

    const verifyToken = crypto.randomUUID()
    await supabase.from('submissions').update({
      email_verification_pin: newPin,
      email_verification_token: verifyToken,
      email_verification_pin_expires_at: expiry,
      email_verification_attempts: 0,
    }).eq('submission_id', subId)

    const siteUrl = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
    await sendResendPinEmail(user.email, user.name || 'there', newPin, verifyToken, siteUrl)
    await supabase.from('events').insert({ event_type: 'pin_resent', submission_id: subId, metadata: {} })

    return json({ success: true })

  } catch (err: any) {
    console.error('resend-pin error:', err)
    return json({ success: false, error: 'Something went wrong. Please try again.' }, 500)
  }
})
