import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { rateLimit, getConfigNumber, runInBackground } from '../_shared/security.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

const json = (data: object, status = 200) =>
  new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { token, submissionId, action } = await req.json()
    // action: 'deactivate' or 'reactivate'
    const subId = Number(submissionId)
    if (typeof token !== 'string' || !/^[0-9a-fA-F]{32,128}$/.test(token) || !Number.isInteger(subId) || subId <= 0 ||
        !['deactivate', 'reactivate'].includes(action))
      return json({ success: false, error: 'Invalid request' }, 400)

    // Same sliding-expiry rule as the other token endpoints
    const expiryDays = await getConfigNumber(supabase, 'match_token_expiry_days', 120)
    const tokenCutoff = new Date(Date.now() - expiryDays * 86400000).toISOString()
    const { data: user } = await supabase.from('users')
      .select('user_id, journey_limit').eq('match_page_token', token).gt('token_created_at', tokenCutoff).single()
    if (!user) return json({ success: false, error: 'Invalid or expired token' }, 401)

    const { data: sub } = await supabase.from('submissions')
      .select('submission_id, journey_status, user_id, email_verification_status').eq('submission_id', subId).eq('user_id', user.user_id).single()
    if (!sub) return json({ success: false, error: 'Journey not found' }, 404)

    const reactivating = action === 'reactivate'
    if (reactivating && sub.journey_status !== 'active') {
      // Reactivation re-runs matching (compute and possibly Mapbox), so it is limited:
      // 3 per journey per day, and it may not exceed the user's active-journey cap.
      const rl = await rateLimit(supabase, `reactivate:${subId}`, 86400, 3)
      if (!rl.allowed) return json({ success: false, error: 'This journey was reactivated too often today. Please try again tomorrow.' }, 429)

      const limit = user.journey_limit ?? (await getConfigNumber(supabase, 'max_journeys_per_user', 10))
      const { count } = await supabase.from('submissions').select('*', { count: 'exact', head: true })
        .eq('user_id', user.user_id).eq('journey_status', 'active')
      if ((count || 0) >= limit)
        return json({ success: false, error: `Maximum of ${limit} active journeys reached. Please archive another journey first.` }, 400)
    }

    const newStatus = reactivating ? 'active' : 'inactive'
    await supabase.from('submissions').update({ journey_status: newStatus }).eq('submission_id', subId)

    await supabase.from('events').insert({
      event_type: reactivating ? 'journey_reactivated' : 'journey_deactivated',
      user_id: user.user_id, submission_id: subId
    })

    // Look for new matches only when this actually flips an unverified-safe journey to active
    if (reactivating && sub.journey_status !== 'active' &&
        ['email_verified', 'verification_skipped'].includes(sub.email_verification_status)) {
      runInBackground(fetch(`${Deno.env.get('DB_URL')}/functions/v1/find-matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('DB_SERVICE_KEY')}` },
        body: JSON.stringify({ submissionId: subId }),
        signal: AbortSignal.timeout(60000)
      }))
    }

    return json({
      success: true, newStatus,
      message: reactivating ? 'Journey reactivated! Looking for new matches.' : 'Journey deactivated. Visible in archived tab.'
    })
  } catch (err: any) {
    console.error('deactivate-journey error:', err)
    return json({ success: false, error: 'Something went wrong. Please try again.' }, 500)
  }
})
