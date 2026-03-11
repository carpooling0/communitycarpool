import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('DB_URL')!,
  Deno.env.get('DB_SERVICE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status
  })
}

function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
         req.headers.get('x-real-ip') || 'unknown'
}

// ── PBKDF2 verify (for deletion PIN) ──────────────────────────────────────────
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

async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  const buf = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)
  const hex = (a: Uint8Array) => Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex(salt)}:${hex(new Uint8Array(buf))}`
}

// ── Session validation ─────────────────────────────────────────────────────────
async function validateSession(req: Request): Promise<{ admin: any; error?: string; status?: number }> {
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '').trim()
  if (!token) return { admin: null, error: 'Authorization token required', status: 401 }

  const { data: session } = await supabase.from('admin_sessions')
    .select('admin_id, expires_at').eq('session_token', token).single()
  if (!session || new Date(session.expires_at) < new Date())
    return { admin: null, error: 'Session expired or invalid', status: 401 }

  const { data: admin } = await supabase.from('admin_users')
    .select('admin_id, name, role, is_active, role_expires_at, deletion_pin_hash')
    .eq('admin_id', session.admin_id).single()
  if (!admin || !admin.is_active) return { admin: null, error: 'Account deactivated', status: 401 }
  if (admin.role_expires_at && new Date(admin.role_expires_at) < new Date())
    return { admin: null, error: 'Access expired', status: 403 }

  return { admin }
}

// ── Role permission check ──────────────────────────────────────────────────────
const ROLE_LEVEL: Record<string, number> = { support: 1, admin: 2, super_admin: 3 }
function requireRole(admin: any, minRole: string): boolean {
  return (ROLE_LEVEL[admin.role] || 0) >= (ROLE_LEVEL[minRole] || 99)
}

// ── Audit logging ──────────────────────────────────────────────────────────────
async function logAction(admin: any, action: string, entityEmail?: string, details?: object, ip?: string) {
  await supabase.from('admin_actions').insert({
    admin_id: admin.admin_id,
    admin_name: admin.name,
    action,
    entity_email: entityEmail || null,
    details: details ? details : null,
    ip_address: ip || null
  })
}

// ── Resend email helper ────────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) { console.error('[admin-api] RESEND_API_KEY not set'); return false }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Community Carpool <hello@communitycarpool.org>',
        to,
        subject,
        html
      })
    })
    if (!res.ok) { console.error('[admin-api] Resend error:', await res.text()); return false }
    return true
  } catch (e: any) {
    console.error('[admin-api] Resend exception:', e.message)
    return false
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const clientIP = getClientIP(req)

  try {
    const { admin, error: authError, status: authStatus } = await validateSession(req)
    if (!admin) return json({ error: authError }, authStatus)

    const body = await req.json()
    const { action } = body

    // ══════════════════════════════════════════════════════════════════════════
    // METRICS (all roles)
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'metrics') {
      const period = body.period || 'weeks'
      const [metricsRes, chartRes] = await Promise.all([
        supabase.rpc('get_admin_metrics'),
        supabase.rpc('get_admin_growth_chart', { p_period: period, p_start: body.startDate || null, p_end: body.endDate || null })
      ])
      if (metricsRes.error) throw metricsRes.error
      if (chartRes.error) throw chartRes.error

      return json({
        success: true,
        ...metricsRes.data,
        charts: {
          ...(metricsRes.data as any).charts,
          growthSeries: chartRes.data
        }
      })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // TICKETS
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'tickets.list') {
      const { status = 'all', search = '', page = 1 } = body
      const pageSize = 50
      const offset = (page - 1) * pageSize

      let q = supabase.from('support_tickets')
        .select('ticket_id, request_type, status, email, ip_address, created_at, resolved_at, resolution_note, issue_against_subject_email, issue_reported_type, details_note, resolved_by, admin_notes, notify_user, closed_by_admin_id', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1)

      if (status !== 'all') q = q.eq('status', status)
      if (search) q = q.or(`email.ilike.%${search}%,ticket_id.eq.${parseInt(search) || 0}`)

      const { data, count, error } = await q
      if (error) throw error
      return json({ success: true, tickets: data, total: count, page, pageSize })
    }

    if (action === 'tickets.save_note') {
      const { ticketId, note } = body
      if (!ticketId) return json({ error: 'ticketId required' }, 400)

      const { data: ticket } = await supabase.from('support_tickets')
        .select('admin_notes, email').eq('ticket_id', ticketId).single()
      if (!ticket) return json({ error: 'Ticket not found' }, 404)

      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const existing = ticket.admin_notes || ''
      const updated = existing
        ? `${existing}\n[${timestamp} by ${admin.name}] ${note}`
        : `[${timestamp} by ${admin.name}] ${note}`

      const { error } = await supabase.from('support_tickets')
        .update({ admin_notes: updated }).eq('ticket_id', ticketId)
      if (error) throw error

      await logAction(admin, 'tickets.save_note', ticket.email, { ticketId, note }, clientIP)
      return json({ success: true })
    }

    if (action === 'tickets.close') {
      const { ticketId, notifyUser = false, adminNote = '' } = body
      if (!ticketId) return json({ error: 'ticketId required' }, 400)

      const { data: ticket } = await supabase.from('support_tickets')
        .select('ticket_id, email, status, admin_notes').eq('ticket_id', ticketId).single()
      if (!ticket) return json({ error: 'Ticket not found' }, 404)
      if (ticket.status === 'closed') return json({ error: 'Ticket already closed' }, 400)

      // Append admin note if provided
      let updatedNotes = ticket.admin_notes || ''
      if (adminNote) {
        const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
        updatedNotes = updatedNotes
          ? `${updatedNotes}\n[${timestamp} by ${admin.name}] ${adminNote}`
          : `[${timestamp} by ${admin.name}] ${adminNote}`
      }

      const { error } = await supabase.from('support_tickets').update({
        status: 'closed',
        resolved_at: new Date().toISOString(),
        closed_by_admin_id: admin.admin_id,
        admin_notes: updatedNotes || null,
        notify_user: notifyUser
      }).eq('ticket_id', ticketId)
      if (error) throw error

      // Notify user by email + user_notification if requested
      if (notifyUser && ticket.email) {
        const noteSection = adminNote
          ? `<p><strong>Note from our team:</strong> ${adminNote}</p>`
          : ''
        await sendEmail(
          ticket.email,
          `Your support ticket #${ticketId} has been reviewed`,
          `<p>Hi,</p>
           <p>Your support ticket <strong>#${ticketId}</strong> has been reviewed and closed by our team.</p>
           ${noteSection}
           <p>If you have further questions, please submit a new support request at <a href="https://communitycarpool.org/support.html">communitycarpool.org/support.html</a>.</p>
           <p>Regards,<br>Community Carpool Team</p>`
        )

        // Also create a user_notification if user exists in our DB
        const { data: user } = await supabase.from('users')
          .select('user_id').eq('email', ticket.email.toLowerCase()).single()
        if (user) {
          await supabase.from('user_notifications').insert({
            user_id: user.user_id,
            message: `Your support ticket #${ticketId} has been reviewed and closed.${adminNote ? ' Note: ' + adminNote : ''}`,
            type: 'ticket_closed'
          })
        }
      }

      await logAction(admin, 'tickets.close', ticket.email, { ticketId, notifyUser }, clientIP)
      return json({ success: true })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DELETIONS (admin + super_admin)
    // ══════════════════════════════════════════════════════════════════════════
    if (action.startsWith('deletions.') && !requireRole(admin, 'admin'))
      return json({ error: 'Insufficient permissions' }, 403)

    if (action === 'deletions.list') {
      const { data, error } = await supabase.from('users')
        .select('user_id, name, email, deletion_requested_at, deletion_token_expires_at')
        .not('deletion_requested_at', 'is', null)
        .order('deletion_requested_at', { ascending: true })
      if (error) throw error
      return json({ success: true, deletions: data })
    }

    if (action === 'deletions.cancel') {
      const { userId } = body
      if (!userId) return json({ error: 'userId required' }, 400)

      const { data: user } = await supabase.from('users')
        .select('user_id, email').eq('user_id', userId).single()
      if (!user) return json({ error: 'User not found' }, 404)

      // Restore user state
      await supabase.from('users').update({
        deletion_requested_at: null,
        deletion_token: null,
        deletion_token_expires_at: null
      }).eq('user_id', userId)

      // Re-activate their submissions
      await supabase.from('submissions')
        .update({ journey_status: 'active' })
        .eq('user_id', userId).eq('journey_status', 'deletion_pending')

      // Find their submission IDs to fix matches
      const { data: subs } = await supabase.from('submissions')
        .select('submission_id').eq('user_id', userId)
      if (subs?.length) {
        const subIds = subs.map((s: any) => s.submission_id)
        await supabase.from('matches')
          .update({ status: 'notified' })
          .eq('status', 'user_deleted')
          .or(`sub_a_id.in.(${subIds.join(',')}),sub_b_id.in.(${subIds.join(',')})`)
      }

      await logAction(admin, 'deletions.cancel', user.email, { userId }, clientIP)
      return json({ success: true })
    }

    if (action === 'deletions.process') {
      const { userId, deletionPin } = body
      if (!userId) return json({ error: 'userId required' }, 400)
      if (!deletionPin) return json({ error: 'deletionPin required' }, 400)

      // Verify deletion PIN
      if (!admin.deletion_pin_hash)
        return json({ error: 'No deletion PIN set for your account. Contact Super-Admin.' }, 403)
      const pinOk = await verifySecret(String(deletionPin), admin.deletion_pin_hash)
      if (!pinOk) return json({ error: 'Incorrect deletion PIN' }, 403)

      const { data: user } = await supabase.from('users')
        .select('user_id, email, name').eq('user_id', userId).single()
      if (!user) return json({ error: 'User not found' }, 404)

      // FK-safe deletion
      const { data: subs } = await supabase.from('submissions')
        .select('submission_id').eq('user_id', userId)
      const subIds = (subs || []).map((s: any) => s.submission_id)

      let matchIds: number[] = []
      if (subIds.length) {
        const { data: matchRows } = await supabase.from('matches')
          .select('match_id')
          .or(`sub_a_id.in.(${subIds.join(',')}),sub_b_id.in.(${subIds.join(',')})`)
        matchIds = (matchRows || []).map((m: any) => m.match_id)
      }

      // Delete events
      await supabase.from('events').delete().eq('user_id', userId)
      if (matchIds.length) {
        await supabase.from('events').delete().in('match_id', matchIds)
      }

      // Delete matches
      if (matchIds.length) await supabase.from('matches').delete().in('match_id', matchIds)

      // Delete submissions
      if (subIds.length) await supabase.from('submissions').delete().in('submission_id', subIds)

      // Delete user notifications
      await supabase.from('user_notifications').delete().eq('user_id', userId)

      // Delete user
      await supabase.from('users').delete().eq('user_id', userId)

      // Log deletion
      await supabase.from('deletion_log').insert({
        email: user.email,
        deleted_at: new Date().toISOString(),
        reason: 'admin_manual'
      })

      await logAction(admin, 'deletions.process', user.email, {
        userId, submissionsDeleted: subIds.length, matchesDeleted: matchIds.length
      }, clientIP)

      return json({ success: true, email: user.email, submissionsDeleted: subIds.length, matchesDeleted: matchIds.length })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // USERS (admin + super_admin)
    // ══════════════════════════════════════════════════════════════════════════
    if (action.startsWith('users.') && !requireRole(admin, 'admin'))
      return json({ error: 'Insufficient permissions' }, 403)

    if (action === 'users.search') {
      const { email } = body
      if (!email) return json({ error: 'email required' }, 400)

      const { data: user } = await supabase.from('users')
        .select('user_id, name, email, first_seen_at, last_seen_at, deletion_requested_at')
        .ilike('email', `%${email.trim()}%`).limit(1).single()
      if (!user) return json({ error: 'User not found' }, 404)

      const { data: subs } = await supabase.from('submissions')
        .select('submission_id, from_location, to_location, distance_km, journey_status, created_at, expires_at')
        .eq('user_id', user.user_id).order('created_at', { ascending: false })

      const subsWithMatches = await Promise.all((subs || []).map(async (sub: any) => {
        const { data: matches } = await supabase.from('matches')
          .select('match_id, match_strength, status, interest_a, interest_b, interest_a_at, interest_b_at, created_at, notification_sent, sub_a_id, sub_b_id')
          .or(`sub_a_id.eq.${sub.submission_id},sub_b_id.eq.${sub.submission_id}`)
          .order('created_at', { ascending: false })

        // Enrich with other party's name (admin sees real names)
        const enriched = await Promise.all((matches || []).map(async (m: any) => {
          const otherSubId = m.sub_a_id === sub.submission_id ? m.sub_b_id : m.sub_a_id
          const { data: otherSub } = await supabase.from('submissions')
            .select('user_id').eq('submission_id', otherSubId).single()
          let otherName = 'Unknown'
          if (otherSub) {
            const { data: otherUser } = await supabase.from('users')
              .select('name, email').eq('user_id', otherSub.user_id).single()
            if (otherUser) otherName = `${otherUser.name} (${otherUser.email})`
          }
          return { ...m, otherParty: otherName }
        }))

        return { ...sub, matches: enriched }
      }))

      return json({ success: true, user, submissions: subsWithMatches })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BLACKLIST (admin + super_admin)
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'blacklist.add') {
      if (!requireRole(admin, 'admin')) return json({ error: 'Insufficient permissions' }, 403)
      const { email, reason } = body
      if (!email) return json({ error: 'email required' }, 400)

      const { error } = await supabase.from('blacklist').insert({
        email: email.toLowerCase().trim(),
        reason: reason || `Blacklisted by admin ${admin.name}`
      })
      if (error && error.code === '23505') return json({ error: 'Email already blacklisted' }, 409)
      if (error) throw error

      await logAction(admin, 'blacklist.add', email, { reason }, clientIP)
      return json({ success: true })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUDIT LOG (super_admin only)
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'audit.list') {
      if (!requireRole(admin, 'super_admin')) return json({ error: 'Insufficient permissions' }, 403)
      const { page = 1, adminFilter = '', actionFilter = '' } = body
      const pageSize = 50
      const offset = (page - 1) * pageSize

      let q = supabase.from('admin_actions')
        .select('action_id, admin_name, action, entity_email, details, ip_address, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1)

      if (adminFilter) q = q.ilike('admin_name', `%${adminFilter}%`)
      if (actionFilter) q = q.ilike('action', `%${actionFilter}%`)

      const { data, count, error } = await q
      if (error) throw error
      return json({ success: true, entries: data, total: count, page, pageSize })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // TEAM MANAGEMENT (super_admin only)
    // ══════════════════════════════════════════════════════════════════════════
    if (action.startsWith('admins.') && !requireRole(admin, 'super_admin'))
      return json({ error: 'Insufficient permissions' }, 403)

    if (action === 'admins.list') {
      const { data, error } = await supabase.from('admin_users')
        .select('admin_id, email, name, role, role_expires_at, allowed_ips, is_active, last_login_at, created_at')
        .order('created_at', { ascending: true })
      if (error) throw error
      return json({ success: true, admins: data })
    }

    if (action === 'admins.create') {
      const { email, name, role, password, deletionPin, roleExpiresAt, allowedIps } = body
      if (!email || !name || !role || !password) return json({ error: 'email, name, role and password required' }, 400)
      if (!['super_admin', 'admin', 'support'].includes(role)) return json({ error: 'Invalid role' }, 400)

      const passwordHash = await hashSecret(password)
      const pinHash = deletionPin ? await hashSecret(String(deletionPin)) : null

      const { data: newAdmin, error } = await supabase.from('admin_users').insert({
        email: email.toLowerCase().trim(),
        name,
        role,
        password_hash: passwordHash,
        deletion_pin_hash: pinHash,
        role_expires_at: roleExpiresAt || null,
        allowed_ips: allowedIps?.length ? allowedIps : null
      }).select('admin_id, name, email, role').single()
      if (error && error.code === '23505') return json({ error: 'Email already exists' }, 409)
      if (error) throw error

      await logAction(admin, 'admins.create', email, { role, name }, clientIP)
      return json({ success: true, admin: newAdmin })
    }

    if (action === 'admins.update') {
      const { targetAdminId, name, role, roleExpiresAt, allowedIps, isActive, newPassword, newDeletionPin } = body
      if (!targetAdminId) return json({ error: 'targetAdminId required' }, 400)

      const { data: target } = await supabase.from('admin_users')
        .select('admin_id, email').eq('admin_id', targetAdminId).single()
      if (!target) return json({ error: 'Admin not found' }, 404)

      const updates: Record<string, any> = {}
      if (name !== undefined) updates.name = name
      if (role !== undefined) {
        if (!['super_admin', 'admin', 'support'].includes(role)) return json({ error: 'Invalid role' }, 400)
        updates.role = role
      }
      if (roleExpiresAt !== undefined) updates.role_expires_at = roleExpiresAt || null
      if (allowedIps !== undefined) updates.allowed_ips = allowedIps?.length ? allowedIps : null
      if (isActive !== undefined) updates.is_active = isActive
      if (newPassword) updates.password_hash = await hashSecret(newPassword)
      if (newDeletionPin) updates.deletion_pin_hash = await hashSecret(String(newDeletionPin))

      if (!Object.keys(updates).length) return json({ error: 'No fields to update' }, 400)

      const { error } = await supabase.from('admin_users').update(updates).eq('admin_id', targetAdminId)
      if (error) throw error

      await logAction(admin, 'admins.update', target.email, { targetAdminId, fields: Object.keys(updates) }, clientIP)
      return json({ success: true })
    }

    return json({ error: `Unknown action: ${action}` }, 400)

  } catch (err: any) {
    console.error('[admin-api]', err)
    return json({ error: err.message }, 500)
  }
})
