import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

const TRANSPARENT_GIF = new Uint8Array([
  0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,0x80,0x00,0x00,
  0x00,0x00,0x00,0xFF,0xFF,0xFF,0x21,0xF9,0x04,0x00,0x00,0x00,0x00,
  0x00,0x2C,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,
  0x44,0x01,0x00,0x3B
])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const batchId = url.searchParams.get('batch')

  if (token) {
    ;(async () => {
      const { data: user } = await supabase
        .from('users')
        .select('user_id')
        .eq('match_page_token', token)
        .single()
      if (!user?.user_id) return

      const now = new Date().toISOString()

      // Log email_opened event
      await supabase.from('events').insert({
        event_type: 'email_opened',
        metadata: { user_id: user.user_id, batch_id: batchId }
      })

      if (!batchId) return

      // Get this user's submission IDs
      const { data: subs } = await supabase
        .from('submissions')
        .select('submission_id')
        .eq('user_id', user.user_id)
      if (!subs || subs.length === 0) return

      const subIds = subs.map((s: any) => s.submission_id)

      // Stamp email_read_at_a for matches where this user is sub_a
      const { data: matchesAsA } = await supabase
        .from('matches')
        .select('match_id')
        .eq('email_batch_id', batchId)
        .in('sub_a_id', subIds)
        .is('email_read_at_a', null)

      if (matchesAsA && matchesAsA.length > 0) {
        await supabase
          .from('matches')
          .update({ email_read_at_a: now })
          .in('match_id', matchesAsA.map((m: any) => m.match_id))
      }

      // Stamp email_read_at_b for matches where this user is sub_b
      const { data: matchesAsB } = await supabase
        .from('matches')
        .select('match_id')
        .eq('email_batch_id', batchId)
        .in('sub_b_id', subIds)
        .is('email_read_at_b', null)

      if (matchesAsB && matchesAsB.length > 0) {
        await supabase
          .from('matches')
          .update({ email_read_at_b: now })
          .in('match_id', matchesAsB.map((m: any) => m.match_id))
      }
    })()
  }

  return new Response(TRANSPARENT_GIF, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    }
  })
})
