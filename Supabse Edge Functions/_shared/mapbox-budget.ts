// ── Mapbox hard monthly cap ───────────────────────────────────────────────────
// Mapbox has no spending cap, so we enforce our own. Call reserveMapboxRequest()
// immediately before every Mapbox request; if it returns false, use haversine.
// Counting happens atomically in Postgres (mapbox_reserve), so concurrent edge
// function invocations cannot overshoot. Fails closed: if the counter cannot be
// reached, the caller falls back to haversine rather than risk uncapped spend.
// The limit comes from config.mapbox_monthly_limit and is cached for 60 seconds.

import { sendEmail } from './send-email.ts'

const DEFAULT_LIMIT = 90000
let cachedLimit = DEFAULT_LIMIT
let cachedAt = 0

async function getLimit(supabase: any): Promise<number> {
  if (Date.now() - cachedAt < 60_000) return cachedLimit
  const { data } = await supabase.from('config').select('value').eq('key', 'mapbox_monthly_limit').single()
  const parsed = parseInt(data?.value)
  cachedLimit = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LIMIT
  cachedAt = Date.now()
  return cachedLimit
}

async function sendCapAlert(supabase: any, used: number, limit: number) {
  try {
    const { data } = await supabase.from('config').select('value').eq('key', 'support_notify_email').single()
    const to = data?.value
    if (!to) return
    await sendEmail(
      to,
      'Mapbox monthly cap reached: switched to haversine',
      `<p>The Mapbox Directions request counter reached its monthly cap (${used} of ${limit}).</p>` +
      `<p>Distance calculations are using straight-line (haversine) for the rest of this month. ` +
      `No further Mapbox charges will accrue from the app. The counter resets at the start of the next UTC month.</p>` +
      `<p>To adjust, change <code>mapbox_monthly_limit</code> in the config table. ` +
      `If this was unexpected, check the <code>mapbox_usage</code> table and recent sign-up volume.</p>`
    )
  } catch (e: any) {
    console.error('Mapbox cap alert failed:', e.message)
  }
}

export async function reserveMapboxRequest(supabase: any): Promise<boolean> {
  try {
    const limit = await getLimit(supabase)
    const { data, error } = await supabase.rpc('mapbox_reserve', { p_limit: limit, p_n: 1 }).single()
    if (error || !data) {
      console.error('mapbox_reserve failed, using haversine:', error?.message)
      return false
    }
    if (!data.allowed && data.first_breach) await sendCapAlert(supabase, data.used, limit)
    return data.allowed === true
  } catch (e: any) {
    console.error('mapbox_reserve threw, using haversine:', e.message)
    return false
  }
}
