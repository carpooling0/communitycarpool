import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireInternal, isValidEmail } from '../_shared/security.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)

// Developer tool: look up recent email delivery events for one address.
// Internal only (service-role key required) and the address is validated before it is
// used in a filter, so the query string cannot be manipulated.
Deno.serve(async (req) => {
  const denied = await requireInternal(req, supabase, 'email-events-query')
  if (denied) return denied

  const url = new URL(req.url)
  const email = (url.searchParams.get('email') || '').toLowerCase().trim()
  if (email && !isValidEmail(email)) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid email' }), { headers: { 'Content-Type': 'application/json' }, status: 400 })
  }

  let query = supabase.from('email_events').select('*').order('occurred_at', { ascending: false }).limit(10)
  if (email) query = query.or(`recipient.eq.${email},raw_payload->>to.eq.${email}`)

  const { data, error } = await query
  if (error) {
    return new Response(JSON.stringify({ success: false, error: 'Query failed' }), { headers: { 'Content-Type': 'application/json' }, status: 500 })
  }
  return new Response(JSON.stringify({ success: true, rows: data }), { headers: { 'Content-Type': 'application/json' } })
})
