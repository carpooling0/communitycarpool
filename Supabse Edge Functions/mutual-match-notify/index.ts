import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

// NOTE: Mutual match notification logic is handled inside update-match-status
// This function is a placeholder for future direct triggers or webhooks

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { matchId } = await req.json()
    // Future: trigger manual re-send of mutual match email
    // For now: just confirm match exists
    const { data: match } = await supabase.from('matches').select('match_id, status').eq('match_id', matchId).single()
    if (!match) return new Response(JSON.stringify({ success: false, error: 'Match not found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })
    return new Response(JSON.stringify({ success: true, matchStatus: match.status }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
