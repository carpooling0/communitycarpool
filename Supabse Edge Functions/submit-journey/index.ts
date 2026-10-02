import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendInitialPinEmail, sendWhatsAppPin } from '../_shared/pin-email.ts'
import { reserveMapboxRequest } from '../_shared/mapbox-budget.ts'
import { clientIp, rateLimit, logSecurityEvent, isValidEmail, cleanText, cleanName, getConfigNumber, generatePin, runInBackground } from '../_shared/security.ts'

const supabase = createClient(
  Deno.env.get('DB_URL')!,
  Deno.env.get('DB_SERVICE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// ── Distance modes ────────────────────────────────────────────────────────────
// 'haversine' → straight-line for everything
// 'mapbox'    → Mapbox Directions API (actual road distance)
// 'hybrid'    → same as 'mapbox' for journey distance; haversine used in find-matches disambiguation only
// ─────────────────────────────────────────────────────────────────────────────
async function roadDistance(
  lat1: number, lng1: number, lat2: number, lng2: number,
  method: string, mapboxToken: string
): Promise<number> {
  if (method === 'haversine') {
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  // mapbox or hybrid — both use Mapbox for journey distance
  if (!mapboxToken) {
    console.error(`MAPBOX_TOKEN not set but distance_method='${method}' — falling back to haversine. Set MAPBOX_TOKEN in Supabase Edge Function secrets.`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  // Hard monthly cap: past mapbox_monthly_limit, fall back to haversine
  if (!(await reserveMapboxRequest(supabase))) {
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  try {
    // Mapbox Directions: coordinates are lng,lat (note order)
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng1},${lat1};${lng2},${lat2}` +
      `?access_token=${mapboxToken}&overview=false&steps=false`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`)
    const json = await res.json()
    if (!json.routes?.length) throw new Error('No route found')
    return json.routes[0].distance / 1000
  } catch (err: any) {
    console.error(`Mapbox failed, falling back to haversine: ${err.message}`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
}

const jsonRes = (data: object, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra }, status })

// "lat,lng" with sane ranges. Returns null when malformed.
function parseLatLng(value: unknown): [number, number] | null {
  if (typeof value !== 'string' || !/^-?\d{1,3}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/.test(value.trim())) return null
  const [lat, lng] = value.split(',').map(Number)
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { firstName, email, fromLocation, fromLatLng, toLocation, toLatLng, distanceValue, country: countryHint, orgCode,
            refCode, utmSource, utmMedium, utmCampaign, termsVersion, termsAgreed,
            whatsappNumber } = body

    // ── Input validation ─────────────────────────────────────────────────────
    // Everything here ends up in emails and admin screens, so reject malformed
    // values up front and strip markup characters from free text.
    const emailClean = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (!isValidEmail(emailClean)) return jsonRes({ success: false, error: 'Please enter a valid email address.' }, 400)
    const nameClean = cleanName(firstName)
    const fromLoc = cleanText(fromLocation, 300)
    const toLoc = cleanText(toLocation, 300)
    const fromCoords = parseLatLng(fromLatLng)
    const toCoords = parseLatLng(toLatLng)
    if (!nameClean || !fromLoc || !toLoc || !fromCoords || !toCoords) {
      return jsonRes({ success: false, error: 'Missing or invalid required fields.' }, 400)
    }
    const [fromLat, fromLng] = fromCoords
    const [toLat, toLng] = toCoords
    const orgCodeClean = typeof orgCode === 'string' && /^[A-Za-z0-9_\-]{1,40}$/.test(orgCode) ? orgCode.toLowerCase() : null
    const refCodeClean = refCode ? cleanText(refCode, 100) : null
    const utmSourceClean = utmSource ? cleanText(utmSource, 100) : null
    const utmMediumClean = utmMedium ? cleanText(utmMedium, 100) : null
    const utmCampaignClean = utmCampaign ? cleanText(utmCampaign, 100) : null
    const waNumberClean = typeof whatsappNumber === 'string' && /^\+?\d{7,15}$/.test(whatsappNumber.trim()) ? whatsappNumber.trim() : null

    const ip = clientIp(req)

    // ── Organisation (needed now: org links can be exempt from IP limits) ────
    let submissionOrgId: number | null = null
    let orgExempt = false
    if (orgCodeClean) {
      const { data: org } = await supabase.from('organisations')
        .select('org_id, rate_limit_exempt').eq('org_code', orgCodeClean).eq('is_active', true).single()
      submissionOrgId = org?.org_id || null
      // Every valid organisation client link is exempt unless that org has opted out
      orgExempt = !!org && org.rate_limit_exempt !== false
    }

    // ── Rate limits ──────────────────────────────────────────────────────────
    // Per IP (skipped for exempt org links, and when the IP cannot be trusted),
    // and per email address so the form cannot be used to email-bomb someone.
    const verificationEnabled   = (await getConfig('email_verification_enabled'))    === 'true'
    const waVerificationEnabled = (await getConfig('whatsapp_verification_enabled')) === 'true'

    if (ip !== 'unknown' && !orgExempt) {
      const perHour = await getConfigNumber(supabase, 'signup_max_per_ip_per_hour', 15)
      const perDay = await getConfigNumber(supabase, 'signup_max_per_ip_per_day', 60)
      const h = await rateLimit(supabase, `signup:ip:${ip}:h`, 3600, perHour)
      const d = await rateLimit(supabase, `signup:ip:${ip}:d`, 86400, perDay)
      if (!h.allowed || !d.allowed) {
        await logSecurityEvent(supabase, 'signup_rate_limited', ip, emailClean, { window: !h.allowed ? 'hour' : 'day' })
        return jsonRes({ success: false, error: 'Too many sign-ups from your network. Please try again later.' }, 429,
          { 'Retry-After': String(!h.allowed ? h.retryAfter : d.retryAfter) })
      }
    }
    if (verificationEnabled) {
      const perHour = await getConfigNumber(supabase, 'pin_max_emails_per_address_per_hour', 5)
      const perDay = await getConfigNumber(supabase, 'pin_max_emails_per_address_per_day', 12)
      const h = await rateLimit(supabase, `pin:email:${emailClean}:h`, 3600, perHour)
      const d = await rateLimit(supabase, `pin:email:${emailClean}:d`, 86400, perDay)
      if (!h.allowed || !d.allowed) {
        await logSecurityEvent(supabase, 'pin_email_rate_limited', ip, emailClean, {})
        return jsonRes({ success: false, error: 'Too many verification emails have been sent to this address. Please try again later.' }, 429)
      }
    }

    let country = countryHint && /^[A-Za-z]{2}$/.test(countryHint) ? countryHint.toUpperCase() : 'AE'
    if (ip !== 'unknown') {
      try {
        const geoRes = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(2000) })
        if (geoRes.ok) {
          const geoData = await geoRes.json()
          if (geoData.success && geoData.country_code) country = geoData.country_code
        }
      } catch { /* silent fail */ }
    }

    const requiredTermsVersion = await getConfig('required_terms_version')
    const acceptedVersion = termsAgreed ? requiredTermsVersion : termsVersion
    if (!acceptedVersion || parseFloat(acceptedVersion) < parseFloat(requiredTermsVersion)) {
      return jsonRes({ success: false, error: 'You must accept the current Terms & Conditions to continue.' }, 400)
    }
    const resolvedTermsVersion = requiredTermsVersion

    const { data: blacklisted } = await supabase
      .from('blacklist').select('blacklist_id').eq('email', emailClean).single()
    if (blacklisted) return jsonRes({ success: false, error: 'This email is not permitted to register.' }, 403)

    let userId: number
    let userJourneyLimit: number | null = null
    const { data: existingUser } = await supabase
      .from('users').select('user_id, journey_limit, ref_code, deletion_requested_at').eq('email', emailClean).single()

    if (existingUser) {
      if (existingUser.deletion_requested_at) {
        return jsonRes({ success: false, error: 'Your account is scheduled for deletion. You cannot create new journeys. Contact support if you changed your mind.' }, 403)
      }
      userId = existingUser.user_id
      userJourneyLimit = existingUser.journey_limit
      // Refresh token_created_at on every new journey: match_page_token expiry is a
      // sliding window based on activity, not a fixed 120 days from original signup.
      const updates: Record<string, any> = { last_seen_at: new Date().toISOString(), token_created_at: new Date().toISOString() }
      // Anyone can type any email address into the form, so an EXISTING account's
      // name and terms acceptance are only changed once the address is verified
      // (verify-pin copies submitted_name across). With verification switched off
      // there is nothing to wait for.
      if (!verificationEnabled) {
        updates.name = nameClean
        updates.terms_accepted_version = resolvedTermsVersion
        updates.terms_accepted_at = new Date().toISOString()
      }
      if (!existingUser.ref_code && refCodeClean) updates.ref_code = refCodeClean
      await supabase.from('users').update(updates).eq('user_id', userId)
      if (!existingUser.ref_code && (utmSourceClean || utmMediumClean || utmCampaignClean)) {
        await supabase.from('user_attribution').insert({ user_id: userId, utm_source: utmSourceClean, utm_medium: utmMediumClean, utm_campaign: utmCampaignClean })
      }
    } else {
      const { data: newUser, error: insertError } = await supabase.from('users')
        .insert({ email: emailClean, name: nameClean, last_seen_at: new Date().toISOString(), ref_code: refCodeClean, terms_accepted_version: resolvedTermsVersion, terms_accepted_at: new Date().toISOString() })
        .select('user_id').single()
      if (insertError) {
        if (insertError.code === '23505') {
          const { data: raceUser } = await supabase.from('users').select('user_id').eq('email', emailClean).single()
          if (!raceUser) throw new Error(`User insert failed and recovery select returned nothing: ${insertError.message}`)
          userId = raceUser.user_id
        } else {
          throw new Error(`Failed to create user: ${insertError.message}`)
        }
      } else {
        userId = newUser!.user_id
      }
      if (utmSourceClean || utmMediumClean || utmCampaignClean) {
        await supabase.from('user_attribution').insert({ user_id: userId, utm_source: utmSourceClean, utm_medium: utmMediumClean, utm_campaign: utmCampaignClean })
      }
    }

    const globalLimit = parseInt(await getConfig('max_journeys_per_user')) || 10
    const journeyLimit = userJourneyLimit ?? globalLimit
    const { count: activeJourneys } = await supabase.from('submissions')
      .select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('journey_status', 'active')
    if ((activeJourneys || 0) >= journeyLimit) {
      return jsonRes({ success: false, error: `Maximum of ${journeyLimit} active journeys reached. Please archive an existing journey first.` }, 400)
    }

    const distancePrefMap: { [key: string]: number } = { '1': 3, '2': 5, '3': 8, '4': 10 }
    const distancePrefKm = distancePrefMap[distanceValue] || 3
    const distanceMethod = await getConfig('distance_method') || 'haversine'
    const mapboxToken = Deno.env.get('MAPBOX_TOKEN') || ''
    const distanceKm = await roadDistance(fromLat, fromLng, toLat, toLng, distanceMethod, mapboxToken)
    const expiryDays = parseInt(await getConfig('journey_expiry_days')) || 90
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiryDays)

    const { count: journeyCount } = await supabase.from('submissions')
      .select('*', { count: 'exact', head: true }).eq('user_id', userId)
    const journeyNum = (journeyCount || 0) + 1

    // ── Email PIN ────────────────────────────────────────────────────────────
    let emailVerificationStatus = 'verification_skipped'
    let pin: string | null = null
    let verifyToken: string | null = null
    let clientSecret: string | null = null
    let pinExpiresAt: string | null = null

    if (verificationEnabled) {
      pin = generatePin()
      verifyToken = crypto.randomUUID()
      clientSecret = crypto.randomUUID()
      const expiry = new Date()
      expiry.setMinutes(expiry.getMinutes() + 15)
      pinExpiresAt = expiry.toISOString()
      emailVerificationStatus = 'email_unverified'
    }

    // ── WhatsApp PIN ─────────────────────────────────────────────────────────
    const waEnabled = waVerificationEnabled && !!waNumberClean
    let waVerificationStatus = 'not_applicable'
    let waPin: string | null = null
    let waPinExpiresAt: string | null = null

    if (waEnabled) {
      waPin = generatePin()
      clientSecret = clientSecret || crypto.randomUUID()
      const waExpiry = new Date()
      waExpiry.setMinutes(waExpiry.getMinutes() + 15)
      waPinExpiresAt = waExpiry.toISOString()
      waVerificationStatus = 'whatsapp_unverified'
    }

    const { data: submission, error: subError } = await supabase.from('submissions')
      .insert({
        from_location: fromLoc, from_point: `POINT(${fromLng} ${fromLat})`,
        from_lat: fromLat, from_lng: fromLng,
        to_location: toLoc, to_point: `POINT(${toLng} ${toLat})`,
        to_lat: toLat, to_lng: toLng,
        distance_pref: distancePrefKm, ip, country,
        user_id: userId, org_id: submissionOrgId,
        journey_status: 'active', journey_num: journeyNum,
        distance_km: Math.round(distanceKm * 10) / 10,
        expires_at: expiresAt.toISOString(),
        terms_version: resolvedTermsVersion,
        submitted_name: nameClean,
        submitted_terms_version: resolvedTermsVersion,
        email_verification_status: emailVerificationStatus,
        email_verification_pin: pin,
        email_verification_token: verifyToken,
        email_verification_pin_expires_at: pinExpiresAt,
        client_verify_secret: clientSecret,
        // WhatsApp verification (null when WA not enabled)
        whatsapp_number:                       waEnabled ? waNumberClean : null,
        whatsapp_verification_status:          waVerificationStatus,
        whatsapp_verification_pin:             waPin,
        whatsapp_verification_pin_expires_at:  waPinExpiresAt,
      }).select('submission_id').single()
    if (subError) throw subError

    await supabase.from('events').insert({
      event_type: 'form_submitted', user_id: userId,
      submission_id: submission!.submission_id,
      metadata: { org_code: orgCodeClean, distance_pref: distancePrefKm }
    })

    // Send the PIN email. Awaited: a fire-and-forget send can be dropped when the
    // edge isolate is torn down as soon as the response is returned.
    if (verificationEnabled && pin && verifyToken) {
      const siteUrl = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
      try {
        await sendInitialPinEmail(emailClean, nameClean, pin, verifyToken, siteUrl)
      } catch (emailErr: any) {
        console.error(`[submit-journey] PIN email failed for submission ${submission!.submission_id}:`, emailErr.message)
      }
    }

    if (waEnabled && waPin && waNumberClean) {
      try {
        await sendWhatsAppPin(waNumberClean, waPin)
      } catch (waErr: any) {
        console.error(`[submit-journey] WA PIN failed for submission ${submission!.submission_id}:`, waErr.message)
      }
    }

    // ── Trigger matching ─────────────────────────────────────────────────────
    // Only when there is no verification step to wait for. When verification is on,
    // verify-pin starts matching once the address is confirmed, so unverified
    // sign-ups never consume matching work, Mapbox requests or other people's inboxes.
    // (matching_mode 'batch' leaves it to the hourly sweep; see match-sweep.)
    const matchingMode = await getConfig('matching_mode')
    if (!verificationEnabled && (matchingMode === 'hybrid' || matchingMode === 'instant')) {
      runInBackground(fetch(`${Deno.env.get('DB_URL')}/functions/v1/find-matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('DB_SERVICE_KEY')}` },
        body: JSON.stringify({ submissionId: submission!.submission_id }),
        signal: AbortSignal.timeout(60000)
      }))
    }

    // verificationChannel tells the frontend which modal variant to show:
    //   'both'  → combined email + WhatsApp modal
    //   'email' → existing email-only modal
    //   'none'  → no modal, go straight to success
    const verificationChannel = waEnabled ? 'both' : verificationEnabled ? 'email' : 'none'

    return jsonRes({
      success: true,
      submissionId: submission!.submission_id,
      journeyNum,
      actualDist: Math.round(distanceKm * 10) / 10,
      verificationRequired: verificationEnabled,
      verificationChannel,
      // Private to this browser; verify-pin and resend-pin require it
      verifySecret: clientSecret,
    })

  } catch (err: any) {
    console.error('submit-journey error:', err)
    return jsonRes({ success: false, error: 'Something went wrong. Please try again.' }, 500)
  }
})
