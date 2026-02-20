import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function maskName(name: string): string {
  return name.trim().split(' ').map(part => part.length > 0 ? part[0] + '*'.repeat(Math.max(part.length - 1, 2)) : '').join(' ')
}

// Parse PostGIS EWKB hex string (geography POINT with SRID 4326) → { lat, lng }
// Format: 01 (little-endian) + 01000020 (type) + E6100000 (SRID 4326) + 8 bytes X (lng) + 8 bytes Y (lat)
function wkbToLatLng(wkb: string | null): { lat: number, lng: number } | null {
  if (!wkb || wkb.length < 42) return null
  try {
    const buf = new ArrayBuffer(8)
    const view = new DataView(buf)
    // X = longitude: bytes 10–17 (hex chars 20–35)
    const xHex = wkb.slice(10, 26)
    for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(xHex.slice(i * 2, i * 2 + 2), 16))
    const lng = view.getFloat64(0, true)
    // Y = latitude: bytes 18–25 (hex chars 36–51)
    const yHex = wkb.slice(26, 42)
    for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(yHex.slice(i * 2, i * 2 + 2), 16))
    const lat = view.getFloat64(0, true)
    if (isNaN(lat) || isNaN(lng)) return null
    return { lat, lng }
  } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (!token) return new Response(JSON.stringify({ success: false, error: 'Token required' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    // Validate token with expiry check
    const { data: config } = await supabase.from('config').select('value').eq('key', 'match_token_expiry_days').single()
    const tokenExpiryDays = parseInt(config?.value || '60')
    const tokenExpiry = new Date()
    tokenExpiry.setDate(tokenExpiry.getDate() - tokenExpiryDays)

    const { data: user, error: userError } = await supabase.from('users')
      .select('user_id, name, email, token_created_at')
      .eq('match_page_token', token)
      .gt('token_created_at', tokenExpiry.toISOString())
      .single()
    if (userError || !user) return new Response(JSON.stringify({ success: false, error: 'Invalid or expired token. Please request a new match email.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 })

    // Get all submissions for this user
    const { data: submissions } = await supabase.from('submissions')
      .select('submission_id, journey_num, from_location, to_location, journey_status, distance_km, interest_while_inactive')
      .eq('user_id', user.user_id).order('created_at', { ascending: false })

    const journeys = []
    for (const sub of submissions || []) {
      // Get matches for this submission — include from_point/to_point for precise map URLs
      const { data: matches } = await supabase.from('matches')
        .select(`
          match_id, match_strength, created_at, status, sub_a_id, sub_b_id,
          interest_a, interest_b,
          sub_a:submissions!sub_a_id (submission_id, from_location, to_location, from_point, to_point, users(name, email)),
          sub_b:submissions!sub_b_id (submission_id, from_location, to_location, from_point, to_point, users(name, email))
        `)
        .or(`sub_a_id.eq.${sub.submission_id},sub_b_id.eq.${sub.submission_id}`)
        .order('created_at', { ascending: false })

      const formattedMatches = (matches || []).map(match => {
        const isSubA = match.sub_a_id === sub.submission_id
        const otherSub = isSubA ? match.sub_b : match.sub_a
        const otherUser = otherSub.users
        const myInterest = isSubA ? match.interest_a : match.interest_b
        const theirInterest = isSubA ? match.interest_b : match.interest_a
        const isMutual = match.status === 'mutual_confirmed' || match.status === 'contact_revealed'

        // Parse WKB geography → lat/lng floats for precise Apple Maps directions URL
        const fromCoords = wkbToLatLng(otherSub.from_point)
        const toCoords = wkbToLatLng(otherSub.to_point)

        return {
          matchId: match.match_id,
          matchStrength: match.match_strength,
          createdAt: match.created_at,
          status: match.status,
          myInterest,
          theirInterest,
          isMutual,
          otherUser: {
            name: isMutual ? otherUser.name : maskName(otherUser.name),
            email: isMutual ? otherUser.email : null,
            fromLocation: otherSub.from_location,
            toLocation: otherSub.to_location,
            fromLat: fromCoords?.lat ?? null,
            fromLng: fromCoords?.lng ?? null,
            toLat: toCoords?.lat ?? null,
            toLng: toCoords?.lng ?? null
          }
        }
      })

      const pendingCount = formattedMatches.filter(m => !m.myInterest && (m.status === 'notified' || m.status === 'viewed' || m.status === 'interest_expressed')).length

      journeys.push({
        submissionId: sub.submission_id,
        journeyNum: sub.journey_num,
        fromLocation: sub.from_location,
        toLocation: sub.to_location,
        journeyStatus: sub.journey_status,
        distanceKm: sub.distance_km,
        pendingCount,
        hasInactiveInterest: sub.interest_while_inactive,
        matches: formattedMatches
      })
    }

    // Track event
    await supabase.from('events').insert({ event_type: 'matches_page_viewed', user_id: user.user_id, metadata: { token_used: true } })

    return new Response(JSON.stringify({ success: true, user: { name: user.name, email: user.email }, journeys }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
