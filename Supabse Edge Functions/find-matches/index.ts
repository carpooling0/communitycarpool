import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// Road distance via Mapbox Directions API — returns actual driving distance in km.
// Falls back to haversine if token missing, method is 'haversine', or API call fails.
async function roadDistance(
  lat1: number, lng1: number, lat2: number, lng2: number,
  method: string, mapboxToken: string
): Promise<number> {
  if (method !== 'mapbox' || !mapboxToken) {
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
    return json.routes[0].distance / 1000  // metres → km
  } catch (err: any) {
    console.warn(`Mapbox fallback to haversine: ${err.message}`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { submissionId } = await req.json()

    // Read distance method config and Mapbox token once per request
    const { data: methodConfig } = await supabase.from('config').select('value').eq('key', 'distance_method').single()
    const distanceMethod = methodConfig?.value || 'haversine'  // 'haversine' | 'mapbox'
    const mapboxToken = Deno.env.get('MAPBOX_TOKEN') || ''

    // Fetch submission coords as floats (stored directly — no WKB parsing needed)
    const { data: sub, error: subError } = await supabase.rpc('get_submission_coords', { p_id: submissionId }).single()
    if (subError || !sub) throw new Error('Submission not found')

    const fromLat = sub.from_lat as number
    const fromLng = sub.from_lng as number
    const toLat   = sub.to_lat   as number
    const toLng   = sub.to_lng   as number
    const radiusMeters = (sub.distance_pref || 3) * 1000

    const rpcParams = {
      radius_meters:  radiusMeters,
      exclude_email:  sub.email,
      exclude_id:     submissionId,
      exclude_org_id: sub.org_id
    }

    // ── Call 1: same-direction candidates ──────────────────────────────────
    // Spatial filter: candidate.FROM ≈ my FROM  AND  candidate.TO ≈ my TO
    const { data: sameDirCandidates } = await supabase.rpc('find_nearby_users', {
      user_from_lat: fromLat, user_from_lng: fromLng,
      user_to_lat:   toLat,   user_to_lng:   toLng,
      ...rpcParams
    })

    // ── Call 2: reverse-direction candidates ───────────────────────────────
    // Spatial filter: candidate.FROM ≈ my TO  AND  candidate.TO ≈ my FROM
    // Catches opposite-direction commuters on the same road — ideal carpoolers.
    const { data: reverseCandidates } = await supabase.rpc('find_nearby_users', {
      user_from_lat: toLat,   user_from_lng: toLng,
      user_to_lat:   fromLat, user_to_lng:   fromLng,
      ...rpcParams
    })

    // ── Merge, deduplicate, tag reversed candidates ────────────────────────
    // A candidate can appear in BOTH lists when FROM/TO endpoints are spatially close
    // (e.g. exact-reverse routes, or same-direction routes within a compact area).
    // For candidates in only one list → direction is unambiguous.
    // For candidates in BOTH lists → compute both distance formulas and pick the
    // classification that gives the SMALLER total distance. This correctly handles:
    //   - Exact reverse (A→B vs B→A): reversed formula gives ~0 km, same-dir gives large
    //   - Same-direction in compact area: same-dir formula gives small, reversed gives large
    const sameDirIds  = new Set((sameDirCandidates  || []).map((c: any) => c.submission_id))
    const reverseIds  = new Set((reverseCandidates  || []).map((c: any) => c.submission_id))

    const allCandidates: any[] = []
    const seen = new Set<number>()

    // Candidates only in same-dir list → unambiguously same-direction
    for (const c of (sameDirCandidates || [])) {
      if (!reverseIds.has(c.submission_id)) {
        allCandidates.push({ ...c, _reversed: false })
        seen.add(c.submission_id)
      }
    }
    // Candidates only in reverse list → unambiguously reversed
    for (const c of (reverseCandidates || [])) {
      if (!sameDirIds.has(c.submission_id)) {
        allCandidates.push({ ...c, _reversed: true })
        seen.add(c.submission_id)
      }
    }
    // Candidates in BOTH lists → pick direction by comparing haversine distances
    // (use haversine here for O(1) cost; Mapbox used later only for the winning formula)
    for (const c of (sameDirCandidates || [])) {
      if (seen.has(c.submission_id)) continue
      const sameDirTotal = haversineDistance(fromLat, fromLng, c.from_lat, c.from_lng)
                         + haversineDistance(toLat,   toLng,   c.to_lat,   c.to_lng)
      const reversedTotal = haversineDistance(fromLat, fromLng, c.to_lat,   c.to_lng)
                          + haversineDistance(toLat,   toLng,   c.from_lat, c.from_lng)
      allCandidates.push({ ...c, _reversed: reversedTotal < sameDirTotal })
      seen.add(c.submission_id)
    }

    if (allCandidates.length === 0) {
      return new Response(JSON.stringify({ success: true, matchesFound: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let matchesFound = 0

    for (const candidate of allCandidates) {
      // Skip if match already exists (unique index on LEAST/GREATEST pair)
      const minId = Math.min(submissionId, candidate.submission_id)
      const maxId = Math.max(submissionId, candidate.submission_id)
      const { data: existing } = await supabase.from('matches')
        .select('match_id').eq('sub_a_id', minId).eq('sub_b_id', maxId).single()
      if (existing) continue

      const candFromLat = candidate.from_lat as number
      const candFromLng = candidate.from_lng as number
      const candToLat   = candidate.to_lat   as number
      const candToLng   = candidate.to_lng   as number
      const isReversed  = candidate._reversed === true

      // ── Compute pickup/dropoff proximity ────────────────────────────────
      // Same-direction:  my FROM ↔ their FROM,  my TO ↔ their TO
      // Reverse-route:   my FROM ↔ their TO,    my TO ↔ their FROM
      // Uses road distance (Mapbox) when distance_method = 'mapbox', haversine otherwise.
      const [startDist, endDist] = await Promise.all([
        isReversed
          ? roadDistance(fromLat, fromLng, candToLat,   candToLng,   distanceMethod, mapboxToken)
          : roadDistance(fromLat, fromLng, candFromLat, candFromLng, distanceMethod, mapboxToken),
        isReversed
          ? roadDistance(toLat, toLng, candFromLat, candFromLng, distanceMethod, mapboxToken)
          : roadDistance(toLat, toLng, candToLat,   candToLng,   distanceMethod, mapboxToken)
      ])

      // Use the looser of the two users' distance preferences
      const maxRadius = Math.max(sub.distance_pref || 3, candidate.distance_pref || 3)

      if (startDist <= maxRadius && endDist <= maxRadius) {
        const matchStrength = Math.round(Math.max(0, Math.min(100,
          100 * (1 - (startDist + endDist) / (2 * maxRadius * 2))
        )))

        const { error: matchError } = await supabase.from('matches').insert({
          sub_a_id: minId, sub_b_id: maxId,
          match_strength: matchStrength,
          status: 'new',
          notification_sent: false
        })

        if (!matchError) {
          matchesFound++
          await supabase.from('events').insert({
            event_type:    'match_detected',
            submission_id: submissionId,
            metadata: {
              matched_with:    candidate.submission_id,
              start_dist:      Math.round(startDist * 10) / 10,
              end_dist:        Math.round(endDist   * 10) / 10,
              match_strength:  matchStrength,
              direction:       isReversed ? 'reverse' : 'same',
              distance_method: distanceMethod
            }
          })
        }
      }
    }

    // ── Instant email notification ─────────────────────────────────────────
    // When matching_mode = 'instant', fire batch-send-emails immediately after
    // creating matches so users are notified within seconds, not the next cron cycle.
    // Fire-and-forget (no await) — email latency must not block this response.
    // Idempotent: batch-send-emails only processes notification_sent=false matches,
    // so the daily cron running later will simply find nothing to do.
    if (matchesFound > 0) {
      const { data: modeConfig } = await supabase.from('config').select('value').eq('key', 'matching_mode').single()
      if (modeConfig?.value === 'instant') {
        fetch(`${Deno.env.get('DB_URL')}/functions/v1/batch-send-emails`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('DB_SERVICE_KEY')}`
          }
        }).catch((e: any) => console.error('batch-send-emails trigger failed:', e.message))
      }
    }

    return new Response(JSON.stringify({ success: true, matchesFound }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('find-matches error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    })
  }
})
