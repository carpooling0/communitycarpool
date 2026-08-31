import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const email = (url.searchParams.get('email') || '').toLowerCase()

  let query = supabase
    .from('email_events')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(10)

  if (email) {
    query = query.or(`recipient.eq.${email},raw_payload->>to.eq.${email}`)
  }

  const { data, error } = await query

  if (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }

  return new Response(JSON.stringify({ success: true, rows: data }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
