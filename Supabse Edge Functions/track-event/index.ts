import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { clientIp, rateLimit, getConfigNumber, logSecurityEvent } from '../_shared/security.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const VALID_EVENTS = ['page_visited','form_started','form_submitted','form_resubmitted','matches_page_viewed','match_interest_expressed','match_declined','journey_deactivated','unsubscribed','carpooling_reported','carpooling_undo','match_email_opened']
// Events that CHANGE a match: these require a valid token that owns the match
const MUTATING_EVENTS = ['carpooling_reported', 'carpooling_undo']

const json = (data: object, status = 200) =>
  new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status })

const posInt = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const ip = clientIp(req)
    // Generous per-IP budget: normal browsing is a handful of events, floods are not
    if (ip !== 'unknown') {
      const rl = await rateLimit(supabase, `track:ip:${ip}`, 600, 300)
      if (!rl.allowed) return json({ success: false, error: 'Too many requests' }, 429)
    }

    const { eventType, token, submissionId, matchId, metadata } = await req.json()
    if (!VALID_EVENTS.includes(eventType)) return json({ success: false, error: 'Invalid event type' }, 400)

    const subId = submissionId ? posInt(submissionId) : null
    const mId = matchId ? posInt(matchId) : null

    let userId: number | null = null
    if (typeof token === 'string' && /^[0-9a-fA-F]{32,128}$/.test(token)) {
      // Validate token with expiry check (same policy as get-matches-page)
      const expiryDays = await getConfigNumber(supabase, 'match_token_expiry_days', 120)
      const tokenExpiry = new Date(Date.now() - expiryDays * 86400000).toISOString()
      const { data: user } = await supabase.from('users').select('user_id')
        .eq('match_page_token', token).gt('token_created_at', tokenExpiry).single()
      userId = user?.user_id || null
    }

    // Changing a match's success flag needs a valid token AND ownership of that match.
    // Before this, anyone could flip it for any match id.
    if (MUTATING_EVENTS.includes(eventType)) {
      if (!userId || !mId) return json({ success: false, error: 'Unauthorized' }, 401)
      const { data: match } = await supabase.from('matches')
        .select('sub_a:submissions!sub_a_id(user_id), sub_b:submissions!sub_b_id(user_id)').eq('match_id', mId).single()
      const owners = [(match as any)?.sub_a?.user_id, (match as any)?.sub_b?.user_id]
      if (!owners.includes(userId)) {
        await logSecurityEvent(supabase, 'track_event_not_owner', ip, String(mId), { eventType })
        return json({ success: false, error: 'Unauthorized' }, 403)
      }
    }

    // Free-form metadata is capped so it cannot be used to fill the database
    let safeMetadata: Record<string, unknown> = {}
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const text = JSON.stringify(metadata)
      if (text.length <= 2000) safeMetadata = metadata
    }

    const userAgent = req.headers.get('user-agent') || ''
    let deviceType = 'desktop'
    if (/mobile/i.test(userAgent)) deviceType = 'mobile'
    else if (/tablet|ipad/i.test(userAgent)) deviceType = 'tablet'

    // Run events insert and matches update in parallel
    const dbOps: Promise<any>[] = []
    dbOps.push(
      supabase.from('events').insert({
        event_type: eventType, user_id: userId,
        submission_id: subId, match_id: mId,
        metadata: safeMetadata, device_type: deviceType
      })
    )
    if (eventType === 'carpooling_reported' && mId) {
      dbOps.push(supabase.from('matches').update({ success_reported: true, success_reported_at: new Date().toISOString() }).eq('match_id', mId))
    } else if (eventType === 'carpooling_undo' && mId) {
      dbOps.push(supabase.from('matches').update({ success_reported: false, success_reported_at: null }).eq('match_id', mId))
    }
    await Promise.allSettled(dbOps)

    return json({ success: true })
  } catch (err: any) {
    console.error('track-event error:', err)
    return json({ success: false, error: 'Internal server error' }, 500)
  }
})
