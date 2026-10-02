// ── Shared security helpers ───────────────────────────────────────────────────
// Used by every function that is reachable from the internet or that sends email.
//   clientIp          trustworthy client IP (Cloudflare header first)
//   isInternalCall    true when the caller holds the service-role key
//   requireInternal   guard for cron-only / server-to-server functions
//   rateLimit         atomic fixed-window limiter backed by rate_limit_hit()
//   logSecurityEvent  durable record of blocks and abuse (security_events table)
//   escapeHtml        encode user text before placing it in HTML or an attribute
//   isValidEmail / cleanText / cleanName   input validation for public forms
//   getConfigNumber   numeric config lookup with a default

// ── Client IP ────────────────────────────────────────────────────────────────
// cf-connecting-ip is set by Cloudflare in front of Supabase and cannot be
// supplied by the caller. x-forwarded-for CAN be spoofed (its first entry is
// whatever the client sent), so it is never preferred. Returns 'unknown' when
// nothing trustworthy is present; callers skip per-IP limits for 'unknown' so
// one bucket never blocks everybody.
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  return 'unknown'
}

// ── Internal-caller check ────────────────────────────────────────────────────
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// The anon key ships in the website, so "a valid Supabase JWT" proves nothing.
// Privileged functions therefore require the SERVICE-ROLE key, which only the
// cron jobs and our own edge functions hold.
export function isInternalCall(req: Request): boolean {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return false
  const keys = [Deno.env.get('DB_SERVICE_KEY'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')]
    .filter((k): k is string => !!k)
  return keys.some(k => timingSafeEqual(bearer, k))
}

export async function requireInternal(
  req: Request, supabase: any, fnName: string, corsHeaders: Record<string, string> = {}
): Promise<Response | null> {
  if (isInternalCall(req)) return null
  const ip = clientIp(req)
  // Log at most a handful per function and IP per hour so a flood cannot fill the table
  const rl = await rateLimit(supabase, `unauth-log:${fnName}:${ip}`, 3600, 5)
  if (rl.allowed) await logSecurityEvent(supabase, 'unauthorized_internal_call', ip, fnName, { method: req.method })
  return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401
  })
}

// ── Rate limiting ────────────────────────────────────────────────────────────
// failClosed: when true an unreachable limiter BLOCKS (use for admin login);
// default is to allow so a database hiccup never takes the public form down.
export async function rateLimit(
  supabase: any, key: string, windowSeconds: number, max: number, failClosed = false
): Promise<{ allowed: boolean; retryAfter: number }> {
  try {
    const { data, error } = await supabase
      .rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds, p_max: max }).single()
    if (error || !data) {
      console.error('rate_limit_hit failed:', error?.message)
      return { allowed: !failClosed, retryAfter: 60 }
    }
    return { allowed: data.allowed === true, retryAfter: data.retry_after ?? windowSeconds }
  } catch (e: any) {
    console.error('rate_limit_hit threw:', e.message)
    return { allowed: !failClosed, retryAfter: 60 }
  }
}

export async function logSecurityEvent(
  supabase: any, eventType: string, ip: string | null, subject: string | null, detail: object = {}
): Promise<void> {
  try {
    await supabase.from('security_events').insert({ event_type: eventType, ip, subject, detail })
  } catch (e: any) {
    console.error('logSecurityEvent failed:', e.message)
  }
}

// ── Output encoding ──────────────────────────────────────────────────────────
// Safe for HTML text AND quoted attribute values (escapes both quote types).
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Input validation ─────────────────────────────────────────────────────────
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email)
}

// Strips control characters and angle brackets, collapses whitespace, caps length.
export function cleanText(value: unknown, maxLen: number): string {
  return String(value ?? '')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001F\u007F<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

export const cleanName = (value: unknown) => cleanText(value, 50)

export async function getConfigNumber(supabase: any, key: string, fallback: number): Promise<number> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  const n = parseFloat(data?.value)
  return Number.isFinite(n) ? n : fallback
}

// ── Verification PIN ─────────────────────────────────────────────────────────
// Uniform 6-digit code from a cryptographic source (rejection sampling avoids
// modulo bias). Leading zeros are allowed, so there are 1,000,000 possibilities.
export function generatePin(digits = 6): string {
  const range = 10 ** digits
  const limit = Math.floor(0x100000000 / range) * range
  const buf = new Uint32Array(1)
  let n: number
  do { crypto.getRandomValues(buf); n = buf[0] } while (n >= limit)
  return String(n % range).padStart(digits, '0')
}

// ── Background work ──────────────────────────────────────────────────────────
// Keeps a promise alive after the response has been sent. A bare fire-and-forget
// fetch can be killed when the isolate is torn down; EdgeRuntime.waitUntil lets
// it finish.
export function runInBackground(task: Promise<unknown>): void {
  const guarded = task.catch((e: any) => console.error('background task failed:', e?.message))
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime
  if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(guarded)
}
