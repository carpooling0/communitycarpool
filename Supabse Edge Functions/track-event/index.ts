import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const VALID_EVENTS = ['page_visited','form_started','form_submitted','form_resubmitted','matches_page_viewed','match_interest_expressed','match_declined','journey_deactivated','unsubscribed']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { eventType, token, submissionId, matchId, metadata } = await req.json()
    if (!VALID_EVENTS.includes(eventType)) return new Response(JSON.stringify({ success: false, error: 'Invalid event type' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    let userId = null
    if (token) {
      const { data: user } = await supabase.from('users').select('user_id').eq('match_page_token', token).single()
      userId = user?.user_id || null
    }

    const userAgent = req.headers.get('user-agent') || ''
    let deviceType = 'desktop'
    if (/mobile/i.test(userAgent)) deviceType = 'mobile'
    else if (/tablet|ipad/i.test(userAgent)) deviceType = 'tablet'

    await supabase.from('events').insert({
      event_type: eventType, user_id: userId,
      submission_id: submissionId || null, match_id: matchId || null,
      metadata: metadata || {}, device_type: deviceType
    })

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    // Silent fail - analytics should never break the app
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
