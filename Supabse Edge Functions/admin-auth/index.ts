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

// ── Email helper ───────────────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
  if (!resendKey || !fromEmail) { console.warn('[admin-auth] Resend not configured — email not sent'); return }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to, subject, html })
  })
}

function passwordResetEmail(name: string, resetUrl: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <div style="background:#15803d;padding:20px 32px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0;font-size:20px">Community Carpool Admin</h2>
      </div>
      <div style="padding:32px;background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <p>Dear ${name},</p>
        <p>We received a request to reset your admin password${name ? '' : ' and/or deletion PIN'}. Click the button below to proceed:</p>
        <div style="text-align:center;margin:32px 0">
          <a href="${resetUrl}" style="background:#15803d;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold;font-size:15px">
            Reset Password &amp; PIN
          </a>
        </div>
        <p style="font-size:13px;color:#6b7280">This link expires in <strong>1 hour</strong>. If you did not request a reset, you can safely ignore this email.</p>
        <p style="font-size:13px;color:#6b7280">For security, do not share this link with anyone.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="margin:0">Regards,</p>
        <p style="margin:4px 0 0"><strong>Community Carpool</strong></p>
      </div>
    </div>`
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
        .select('admin_id, name, role, is_active, role_expires_at, deletion_pin_hash').eq('admin_id', session.admin_id).single()

      if (!admin || !admin.is_active) return json({ error: 'Account deactivated' }, 401)

      if (admin.role_expires_at && new Date(admin.role_expires_at) < new Date())
        return json({ error: 'Your access has expired. Contact Super-Admin.' }, 403)

      return json({
        success: true,
        adminId: admin.admin_id,
        name: admin.name,
        role: admin.role,
        expiresAt: session.expires_at,
        hasPin: !!admin.deletion_pin_hash
      })
    }

    // ── LOGOUT ────────────────────────────────────────────────────────────────
    if (action === 'logout') {
      const { token } = body
      if (token) await supabase.from('admin_sessions').delete().eq('session_token', token)
      return json({ success: true })
    }

    // ── FORGOT PASSWORD — send reset link to admin email ──────────────────────
    if (action === 'forgot_password') {
      const { email } = body
      if (!email) return json({ error: 'Email required' }, 400)

      const { data: admin } = await supabase.from('admin_users')
        .select('admin_id, name, is_active')
        .eq('email', email.toLowerCase().trim()).single()

      // Always return success — don't reveal whether the email exists
      if (!admin || !admin.is_active) return json({ success: true })

      // Generate 16-byte reset token (32 hex chars)
      const resetToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0')).join('')
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

      await supabase.from('admin_users').update({
        reset_token: resetToken,
        reset_token_expires_at: expiresAt
      }).eq('admin_id', admin.admin_id)

      const adminUrl = Deno.env.get('ADMIN_URL') || 'https://communitycarpool.org/admin.html'
      const resetUrl = `${adminUrl}?reset_token=${resetToken}`

      await sendEmail(
        email.toLowerCase().trim(),
        'Reset your Community Carpool admin password',
        passwordResetEmail(admin.name, resetUrl)
      )

      return json({ success: true })
    }

    // ── RESET PASSWORD — consume reset token, set new password (+ optional PIN) ─
    if (action === 'reset_password') {
      const { reset_token, new_password, new_pin } = body
      if (!reset_token || !new_password) return json({ error: 'reset_token and new_password required' }, 400)
      if (new_password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)
      if (new_pin !== undefined && new_pin !== null && new_pin !== '') {
        if (!/^\d{6}$/.test(String(new_pin))) return json({ error: 'PIN must be exactly 6 digits' }, 400)
      }

      const { data: admin } = await supabase.from('admin_users')
        .select('admin_id, name, reset_token_expires_at, is_active')
        .eq('reset_token', reset_token).single()

      if (!admin) return json({ error: 'Invalid or expired reset link.' }, 400)
      if (!admin.is_active) return json({ error: 'Account deactivated.' }, 403)
      if (new Date(admin.reset_token_expires_at) < new Date())
        return json({ error: 'Reset link has expired. Please request a new one.' }, 400)

      const updates: Record<string, unknown> = {
        password_hash: await hashSecret(new_password),
        reset_token: null,
        reset_token_expires_at: null
      }
      if (new_pin !== undefined && new_pin !== null && new_pin !== '') {
        updates.deletion_pin_hash = await hashSecret(String(new_pin))
      }

      await supabase.from('admin_users').update(updates).eq('admin_id', admin.admin_id)

      // Invalidate all existing sessions so they must log in fresh
      await supabase.from('admin_sessions').delete().eq('admin_id', admin.admin_id)

      return json({ success: true, message: 'Password updated. Please log in.' })
    }

    return json({ error: 'Unknown action' }, 400)

  } catch (err: any) {
    console.error('[admin-auth]', err)
    return json({ error: err.message }, 500)
  }
})
