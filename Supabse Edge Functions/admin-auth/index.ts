import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('DB_URL')!,
  Deno.env.get('DB_SERVICE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── PBKDF2 helpers ─────────────────────────────────────────────────────────────
// Format: "saltHex:hashHex" — 16-byte salt, 32-byte key, 100k iterations, SHA-256
async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  const buf = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)
  const hex = (a: Uint8Array) => Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex(salt)}:${hex(new Uint8Array(buf))}`
}

async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const [saltHex, hashHex] = parts
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  const buf = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)
  const computed = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  return computed === hashHex
}

function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
         req.headers.get('x-real-ip') || 'unknown'
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status
  })
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const clientIP = getClientIP(req)

  try {
    const body = await req.json()
    const { action } = body

    // ── BOOTSTRAP — only works when admin_users is empty ──────────────────────
    if (action === 'bootstrap') {
      const { email, password, deletionPin, name } = body
      if (!email || !password || !name) return json({ error: 'name, email and password required' }, 400)

      const { count } = await supabase.from('admin_users').select('*', { count: 'exact', head: true })
      if ((count || 0) > 0) return json({ error: 'Admin already exists. Use login.' }, 409)

      const passwordHash = await hashSecret(password)
      const pinHash = deletionPin ? await hashSecret(String(deletionPin)) : null

      const { error } = await supabase.from('admin_users').insert({
        email: email.toLowerCase().trim(),
        name,
        password_hash: passwordHash,
        deletion_pin_hash: pinHash,
        role: 'super_admin'
      })
      if (error) throw error

      return json({ success: true, message: `Super-admin '${name}' created. You can now log in.` })
    }

    // ── LOGIN ─────────────────────────────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = body
      if (!email || !password) return json({ error: 'Email and password required' }, 400)

      const { data: admin } = await supabase.from('admin_users')
        .select('admin_id, name, role, password_hash, allowed_ips, is_active, role_expires_at')
        .eq('email', email.toLowerCase().trim()).single()

      // Vague error for security — don't reveal whether email exists
      if (!admin || !admin.is_active) return json({ error: 'Invalid email or password' }, 401)

      const valid = await verifySecret(password, admin.password_hash)
      if (!valid) return json({ error: 'Invalid email or password' }, 401)

      if (admin.role_expires_at && new Date(admin.role_expires_at) < new Date())
        return json({ error: 'Your access has expired. Contact Super-Admin.' }, 403)

      if (admin.allowed_ips?.length && !admin.allowed_ips.includes(clientIP))
        return json({ error: 'Access not allowed from this IP address.' }, 403)

      // Generate 32-byte session token
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0')).join('')
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

      await supabase.from('admin_sessions').insert({
        session_token: token, admin_id: admin.admin_id, expires_at: expiresAt
      })
      await supabase.from('admin_users')
        .update({ last_login_at: new Date().toISOString() }).eq('admin_id', admin.admin_id)

      return json({ success: true, token, role: admin.role, name: admin.name, expiresAt })
    }

    // ── ME — validate session and return current admin info ───────────────────
    if (action === 'me') {
      const { token } = body
      if (!token) return json({ error: 'Token required' }, 400)

      const { data: session } = await supabase.from('admin_sessions')
        .select('admin_id, expires_at').eq('session_token', token).single()

      if (!session || new Date(session.expires_at) < new Date())
        return json({ error: 'Session expired or invalid' }, 401)

      const { data: admin } = await supabase.from('admin_users')
        .select('admin_id, name, role, is_active, role_expires_at').eq('admin_id', session.admin_id).single()

      if (!admin || !admin.is_active) return json({ error: 'Account deactivated' }, 401)

      if (admin.role_expires_at && new Date(admin.role_expires_at) < new Date())
        return json({ error: 'Your access has expired. Contact Super-Admin.' }, 403)

      return json({
        success: true,
        adminId: admin.admin_id,
        name: admin.name,
        role: admin.role,
        expiresAt: session.expires_at
      })
    }

    // ── LOGOUT ────────────────────────────────────────────────────────────────
    if (action === 'logout') {
      const { token } = body
      if (token) await supabase.from('admin_sessions').delete().eq('session_token', token)
      return json({ success: true })
    }

    return json({ error: 'Unknown action' }, 400)

  } catch (err: any) {
    console.error('[admin-auth]', err)
    return json({ error: err.message }, 500)
  }
})
