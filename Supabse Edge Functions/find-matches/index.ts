import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { reserveMapboxRequest } from '../_shared/mapbox-budget.ts'
import { requireInternal, getConfigNumber, runInBackground } from '../_shared/security.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// ── Distance modes ────────────────────────────────────────────────────────────
// 'haversine' → straight-line for everything
// 'mapbox'    → Mapbox Directions API for everything (proximity + disambiguation)
// 'hybrid'    → Mapbox for proximity scoring, haversine for direction disambiguation
// ─────────────────────────────────────────────────────────────────────────────

async function mapboxDistance(
  lat1: number, lng1: number, lat2: number, lng2: number,
  mapboxToken: string
): Promise<number> {
  // Mapbox Directions: coordinates are lng,lat (note order)
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng1},${lat1};${lng2},${lat2}` +
    `?access_token=${mapboxToken}&overview=false&steps=false`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`)
  const json = await res.json()
  if (!json.routes?.length) throw new Error('No route found')
  return json.routes[0].distance / 1000  // metres → km
}

// calcDistance: respects distance_method config for proximity scoring
// 'mapbox' | 'hybrid' → Mapbox; 'haversine' → straight-line
async function calcDistance(
  lat1: number, lng1: number, lat2: number, lng2: number,
  method: string, mapboxToken: string
): Promise<number> {
  if (method === 'haversine') {
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  // mapbox or hybrid — both use Mapbox for proximity scoring
  if (!mapboxToken) {
    console.error(`MAPBOX_TOKEN not set but distance_method='${method}' — falling back to haversine. Set MAPBOX_TOKEN in Edge Function secrets.`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  // Hard monthly cap: past mapbox_monthly_limit, fall back to haversine
  if (!(await reserveMapboxRequest(supabase))) {
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  try {
    return await mapboxDistance(lat1, lng1, lat2, lng2, mapboxToken)
  } catch (err: any) {
    console.error(`Mapbox failed, falling back to haversine: ${err.message}`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
}

// ── Proximity with minimal Mapbox use ────────────────────────────────────────
// A road is never shorter than the straight line, so:
//   straight > radius            → cannot qualify, no Mapbox needed
//   straight <= trust * radius   → comfortably inside, accept the straight-line figure
//   in between                   → borderline, ask Mapbox for the real road distance
// Only the borderline band costs a request, and calcDistance() still enforces the
// monthly Mapbox cap (mapbox_usage) before every call.
async function proximity(
  lat1: number, lng1: number, lat2: number, lng2: number,
  maxRadius: number, method: string, mapboxToken: string, trustRatio: number
): Promise<number> {
  const straight = haversineDistance(lat1, lng1, lat2, lng2)
  if (method === 'haversine') return straight
  if (straight > maxRadius) return straight
  if (straight <= trustRatio * maxRadius) return straight
  return await calcDistance(lat1, lng1, lat2, lng2, method, mapboxToken)
}

// Direction is decided on straight-line distance: it only compares two totals, so road
// accuracy adds nothing and would cost four Mapbox requests per ambiguous candidate.
function isReversedCandidate(
  fromLat: number, fromLng: number, toLat: number, toLng: number,
  cFromLat: number, cFromLng: number, cToLat: number, cToLng: number
): boolean {
  const sameDirTotal  = haversineDistance(fromLat, fromLng, cFromLat, cFromLng) + haversineDistance(toLat, toLng, cToLat, cToLng)
  const reversedTotal = haversineDistance(fromLat, fromLng, cToLat, cToLng)     + haversineDistance(toLat, toLng, cFromLat, cFromLng)
  return reversedTotal < sameDirTotal
}

const strengthFor = (startDist: number, endDist: number, maxRadius: number) =>
  Math.round(Math.max(0, Math.min(100, 100 * (1 - (startDist + endDist) / (2 * maxRadius * 2)))))

// Only journeys whose owner has proven the email address take part in matching.
// 'verification_skipped' covers journeys created while verification was switched off.
const MATCHABLE = ['email_verified', 'verification_skipped']

async function verifiedIds(ids: number[]): Promise<Set<number>> {
  const ok = new Set<number>()
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from('submissions').select('submission_id')
      .in('submission_id', ids.slice(i, i + 150)).in('email_verification_status', MATCHABLE)
    for (const r of data || []) ok.add(r.submission_id)
  }
  return ok
}

type MatchOutcome = { matchesFound: number; skipped?: string }

async function matchSubmission(submissionId: number, cfg: { method: string; mapboxToken: string; trustRatio: number; maxMatches: number }): Promise<MatchOutcome> {
  const { method, mapboxToken, trustRatio, maxMatches } = cfg

  const { data: sub, error: subError } = await supabase.rpc('get_submission_coords', { p_id: submissionId }).single()
  if (subError || !sub) throw new Error('Submission not found')

  // Unverified journeys wait. verify-pin (or the hourly sweep) matches them once verified.
  const { data: me } = await supabase.from('submissions').select('email_verification_status').eq('submission_id', submissionId).single()
  if (!me || !MATCHABLE.includes(me.email_verification_status)) return { matchesFound: 0, skipped: 'unverified' }

  const fromLat = sub.from_lat as number, fromLng = sub.from_lng as number
  const toLat = sub.to_lat as number,     toLng = sub.to_lng as number

  // Guard: reject submissions with missing or NaN coordinates (legacy data or DB issue)
  if (!fromLat || !fromLng || !toLat || !toLng || isNaN(fromLat) || isNaN(fromLng) || isNaN(toLat) || isNaN(toLng)) {
    console.error(`Submission ${submissionId} has invalid coordinates`)
    await supabase.from('submissions').update({ matched_at: new Date().toISOString() }).eq('submission_id', submissionId)
    return { matchesFound: 0, skipped: 'invalid_coordinates' }
  }

  const radiusMeters = (sub.distance_pref || 3) * 1000
  const rpcParams = { radius_meters: radiusMeters, exclude_email: sub.email, exclude_id: submissionId, exclude_org_id: sub.org_id }

  const [{ data: sameDir }, { data: reverse }] = await Promise.all([
    supabase.rpc('find_nearby_users', { user_from_lat: fromLat, user_from_lng: fromLng, user_to_lat: toLat, user_to_lng: toLng, ...rpcParams }),
    supabase.rpc('find_nearby_users', { user_from_lat: toLat, user_from_lng: toLng, user_to_lat: fromLat, user_to_lng: fromLng, ...rpcParams }),
  ])

  // Merge the two directions; a candidate in both lists is resolved by straight-line distance
  const reverseIds = new Set((reverse || []).map((c: any) => c.submission_id))
  const sameIds = new Set((sameDir || []).map((c: any) => c.submission_id))
  const pool: any[] = []
  const seen = new Set<number>()
  for (const c of sameDir || []) {
    if (seen.has(c.submission_id)) continue
    seen.add(c.submission_id)
    const reversed = reverseIds.has(c.submission_id)
      ? isReversedCandidate(fromLat, fromLng, toLat, toLng, c.from_lat, c.from_lng, c.to_lat, c.to_lng) : false
    pool.push({ ...c, _reversed: reversed })
  }
  for (const c of reverse || []) {
    if (seen.has(c.submission_id) || sameIds.has(c.submission_id)) continue
    seen.add(c.submission_id)
    pool.push({ ...c, _reversed: true })
  }

  // What this journey already holds, so we skip known pairs and respect the cap
  const { data: mineRaw } = await supabase.from('matches')
    .select('match_id, sub_a_id, sub_b_id, status')
    .or(`sub_a_id.eq.${submissionId},sub_b_id.eq.${submissionId}`)
  const mine = (mineRaw || []).filter((m: any) => m.status !== 'user_deleted')
  const alreadyMatched = new Set<number>((mineRaw || []).map((m: any) => (m.sub_a_id === submissionId ? m.sub_b_id : m.sub_a_id)))
  const slots = Math.max(0, maxMatches - mine.length)

  let matchesFound = 0
  if (slots > 0 && pool.length > 0) {
    const verified = await verifiedIds(pool.map(c => c.submission_id))

    // Cheap pass first: straight-line distances decide who could possibly qualify and rank them
    const ranked = pool
      .filter(c => verified.has(c.submission_id) && !alreadyMatched.has(c.submission_id))
      .map(c => {
        const [aLat, aLng] = c._reversed ? [c.to_lat, c.to_lng] : [c.from_lat, c.from_lng]
        const [bLat, bLng] = c._reversed ? [c.from_lat, c.from_lng] : [c.to_lat, c.to_lng]
        const maxRadius = Math.max(sub.distance_pref || 3, c.distance_pref || 3)
        const sStart = haversineDistance(fromLat, fromLng, aLat, aLng)
        const sEnd   = haversineDistance(toLat, toLng, bLat, bLng)
        return { c, aLat, aLng, bLat, bLng, maxRadius, sStart, sEnd, approx: strengthFor(sStart, sEnd, maxRadius) }
      })
      .filter(x => x.sStart <= x.maxRadius && x.sEnd <= x.maxRadius)
      .sort((x, y) => y.approx - x.approx)

    let accepted = 0
    for (const x of ranked) {
      if (accepted >= slots) break   // journey is full: strongest candidates were taken first
      const [startDist, endDist] = await Promise.all([
        proximity(fromLat, fromLng, x.aLat, x.aLng, x.maxRadius, method, mapboxToken, trustRatio),
        proximity(toLat, toLng, x.bLat, x.bLng, x.maxRadius, method, mapboxToken, trustRatio),
      ])
      if (startDist > x.maxRadius || endDist > x.maxRadius) continue
      const matchStrength = strengthFor(startDist, endDist, x.maxRadius)

      // The other journey may be full too. It only makes room for a clearly stronger
      // match, by retiring its weakest match that has not been emailed yet.
      const candId = x.c.submission_id
      const { data: theirRaw } = await supabase.from('matches')
        .select('match_id, match_strength, status, notification_sent')
        .or(`sub_a_id.eq.${candId},sub_b_id.eq.${candId}`)
      const theirs = (theirRaw || []).filter((m: any) => m.status !== 'user_deleted')
      if (theirs.length >= maxMatches) {
        const weakest = theirs.filter((m: any) => m.status === 'new' && m.notification_sent === false)
          .sort((p: any, q: any) => p.match_strength - q.match_strength)[0]
        if (!weakest || weakest.match_strength >= matchStrength) continue
        const { error: delErr } = await supabase.from('matches').delete().eq('match_id', weakest.match_id).eq('status', 'new').eq('notification_sent', false)
        if (delErr) continue   // still referenced elsewhere: leave it, skip this candidate
      }

      const minId = Math.min(submissionId, candId)
      const maxId = Math.max(submissionId, candId)
      const { error: matchError } = await supabase.from('matches').upsert({
        sub_a_id: minId, sub_b_id: maxId, match_strength: matchStrength, status: 'new', notification_sent: false
      }, { onConflict: 'sub_a_id,sub_b_id', ignoreDuplicates: true })

      if (!matchError) {
        accepted++
        matchesFound++
        await supabase.from('events').insert({
          event_type: 'match_detected', submission_id: submissionId,
          metadata: {
            matched_with: candId,
            start_dist: Math.round(startDist * 10) / 10, end_dist: Math.round(endDist * 10) / 10,
            match_strength: matchStrength, direction: x.c._reversed ? 'reverse' : 'same', distance_method: method
          }
        })
      }
    }
  }

  await supabase.from('submissions').update({ matched_at: new Date().toISOString() }).eq('submission_id', submissionId)
  return { matchesFound }
}

const json = (data: object, status = 200) =>
  new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Privileged: only the cron jobs and our own functions (service-role key) may call this.
  const denied = await requireInternal(req, supabase, 'find-matches', corsHeaders)
  if (denied) return denied

  try {
    const body = await req.json().catch(() => ({}))

    const { data: methodConfig } = await supabase.from('config').select('value').eq('key', 'distance_method').single()
    const method = methodConfig?.value || 'haversine'   // 'haversine' | 'mapbox' | 'hybrid'
    const mapboxToken = Deno.env.get('MAPBOX_TOKEN') || ''
    if ((method === 'mapbox' || method === 'hybrid') && !mapboxToken) {
      console.error(`distance_method='${method}' but MAPBOX_TOKEN is not set: all distances will use haversine.`)
    }
    const cfg = {
      method, mapboxToken,
      trustRatio: await getConfigNumber(supabase, 'mapbox_trust_haversine_ratio', 0.6),
      maxMatches: await getConfigNumber(supabase, 'max_matches_per_submission', 25),
    }
    const { data: modeConfig } = await supabase.from('config').select('value').eq('key', 'matching_mode').single()
    const mode = modeConfig?.value || 'hybrid'

    // ── Sweep: match journeys that are verified but not yet matched ──────────
    // Runs every 10 minutes. In 'batch' mode it is how matching happens; in 'hybrid' / 'instant'
    // it is a safety net for journeys whose on-submit call was lost.
    if (body.sweep === true) {
      const graceMinutes = mode === 'batch' ? 0 : 10
      const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000).toISOString()
      const { data: pending } = await supabase.from('submissions')
        .select('submission_id').is('matched_at', null).eq('journey_status', 'active')
        .in('email_verification_status', MATCHABLE).lt('created_at', cutoff)
        .order('created_at', { ascending: true }).limit(12)

      const started = Date.now()
      let processed = 0, totalMatches = 0
      for (const row of pending || []) {
        if (Date.now() - started > 100_000) break   // stay inside the function time limit
        try {
          const r = await matchSubmission(row.submission_id, cfg)
          totalMatches += r.matchesFound
        } catch (e: any) {
          console.error(`sweep: submission ${row.submission_id} failed:`, e.message)
        }
        processed++
      }
      return json({ success: true, sweep: true, pending: pending?.length || 0, processed, matchesFound: totalMatches })
    }

    // ── Single submission ────────────────────────────────────────────────────
    const submissionId = Number(body.submissionId)
    if (!Number.isInteger(submissionId) || submissionId <= 0) return json({ success: false, error: 'submissionId required' }, 400)

    const { matchesFound, skipped } = await matchSubmission(submissionId, cfg)

    // ── Instant email notification ───────────────────────────────────────────
    if (matchesFound > 0 && mode === 'instant') {
      runInBackground(fetch(`${Deno.env.get('DB_URL')}/functions/v1/batch-send-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('DB_SERVICE_KEY')}` },
      }))
    }

    return json({ success: true, matchesFound, ...(skipped ? { skipped } : {}) })
  } catch (err: any) {
    console.error('find-matches error:', err)
    return json({ success: false, error: err.message }, 500)
  }
})
