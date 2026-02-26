import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = new URL(req.url)
    const orgCode = url.searchParams.get('org')
    if (!orgCode) return new Response(JSON.stringify({ success: false, error: 'org parameter required' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    const { data: org, error: orgError } = await supabase.from('organisations')
      .select('org_id, org_name, logo_url, custom_message').eq('org_code', orgCode.toLowerCase()).eq('is_active', true).single()
    if (orgError || !org) return new Response(JSON.stringify({ success: false, error: 'Organisation not found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })

    const { data: locations, error: locError } = await supabase.from('org_locations')
      .select('location_id, location_name, location_latlng').eq('org_id', org.org_id).eq('is_active', true).order('location_name')
    if (locError) throw locError

    return new Response(JSON.stringify({
      success: true,
      org: { name: org.org_name, logoUrl: org.logo_url, customMessage: org.custom_message },
      locations: locations || []
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
