// ── Unified email sender ──────────────────────────────────────────────────────
// Routes to Resend or AWS SES based on the `email_service` config key in DB.
// Returns the message ID (Resend: "re_xxxx", SES: UUID) or null on failure.
// Optional `tags` array is forwarded to Resend for webhook event correlation.

import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.19'

async function getEmailService(): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return 'resend'
  const res = await fetch(`${url}/rest/v1/config?key=eq.email_service&select=value`, {
    headers: { 'Authorization': `Bearer ${key}`, 'apikey': key }
  })
  if (!res.ok) return 'resend'
  const rows = await res.json()
  return rows?.[0]?.value || 'resend'
}

async function sendViaResend(
  to: string, subject: string, html: string,
  tags?: Array<{ name: string; value: string }>
): Promise<string | null> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
  if (!resendKey) throw new Error('RESEND_API_KEY not set')
  const payload: any = { from: `Community Carpool <${fromEmail}>`, to: [to], subject, html }
  if (tags && tags.length > 0) payload.tags = tags
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.id || null
}

async function sendViaSes(to: string, subject: string, html: string): Promise<string | null> {
  const keyId     = Deno.env.get('AWS_ACCESS_KEY_ID')
  const secret    = Deno.env.get('AWS_SECRET_ACCESS_KEY')
  const region    = Deno.env.get('AWS_REGION') || 'ap-south-1'
  const fromEmail = Deno.env.get('SES_FROM_EMAIL') || ''
  if (!keyId || !secret || !fromEmail) throw new Error('AWS SES secrets not fully configured')
  const aws = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, region, service: 'ses' })
  const payload = {
    FromEmailAddress: `Community Carpool <${fromEmail}>`,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } }
      }
    }
  }
  const res = await aws.fetch(
    `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  )
  if (!res.ok) throw new Error(`SES error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.MessageId || null
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  tags?: Array<{ name: string; value: string }>
): Promise<string | null> {
  const provider = await getEmailService()
  if (provider === 'ses') return sendViaSes(to, subject, html)
  return sendViaResend(to, subject, html, tags)
}
