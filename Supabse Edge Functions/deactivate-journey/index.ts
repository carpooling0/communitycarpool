import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { token, submissionId, action } = await req.json()
    // action: 'deactivate' or 'reactivate'

    const { data: user, error: userError } = await supabase.from('users').select('user_id').eq('match_page_token', token).single()
    if (userError || !user) return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 })

    const { data: sub, error: subError } = await supabase.from('submissions')
      .select('submission_id, journey_status, user_id').eq('submission_id', submissionId).eq('user_id', user.user_id).single()
    if (subError || !sub) return new Response(JSON.stringify({ success: false, error: 'Journey not found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })

    const newStatus = action === 'reactivate' ? 'active' : 'inactive'
    await supabase.from('submissions').update({ journey_status: newStatus }).eq('submission_id', submissionId)

    await supabase.from('events').insert({
      event_type: action === 'reactivate' ? 'journey_reactivated' : 'journey_deactivated',
      user_id: user.user_id, submission_id: submissionId
    })

    if (action === 'reactivate') {
      await fetch(`${Deno.env.get('DB_URL')}/functions/v1/find-matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('DB_SERVICE_KEY')}` },
        body: JSON.stringify({ submissionId })
      })
    }

    return new Response(JSON.stringify({
      success: true, newStatus,
      message: action === 'reactivate' ? 'Journey reactivated! Looking for new matches.' : 'Journey deactivated. Visible in archived tab.'
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
