// ── PIN email HTML builder + sender ───────────────────────────────────────────
// Used by: submit-journey (variant='initial') and resend-pin (variant='resend').
// Both emails share the same PIN box design and branding; they differ in:
//   - <title> text
//   - Preheader text
//   - Card header title + subtitle
//   - Body copy above the PIN boxes
//   - Journey tracker placement (inside card for initial; outside for resend)
//   - "Confirm" button label copy

// ── Send WhatsApp PIN via Meta Cloud API ─────────────────────────────────────
// Uses the whatsapp_accountcreation_cc template (single pin_code param).
export async function sendWhatsAppPin(to: string, pin: string): Promise<void> {
  const accessToken   = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')

  if (!accessToken || !phoneNumberId)
    throw new Error('WhatsApp secrets not configured (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)')

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type: 'template',
        template: {
          name:     'whatsapp_accountcreation_cc',
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', parameter_name: 'pin_code', text: pin },
              ],
            },
          ],
        },
      }),
    }
  )
  if (!res.ok) throw new Error(`WhatsApp API error ${res.status}: ${await res.text()}`)
}

import { sendEmail } from './send-email.ts'
import { buildPinEmailHtml, pinEmailSubject } from './pin-email-template.ts'

// ── Initial PIN email (submit-journey) ───────────────────────────────────────
export async function sendInitialPinEmail(
  toEmail: string,
  firstName: string,
  pin: string,
  verifyToken: string,
  siteUrl: string
): Promise<void> {
  const html = buildPinEmailHtml({ variant: 'initial', firstName, pin, verifyLink: `${siteUrl}/?verify_email=${verifyToken}` })
  await sendEmail(toEmail, pinEmailSubject(pin), html)
}

// ── Resend PIN email (resend-pin) ─────────────────────────────────────────────
export async function sendResendPinEmail(
  toEmail: string,
  firstName: string,
  pin: string,
  verifyToken: string,
  siteUrl: string
): Promise<void> {
  const html = buildPinEmailHtml({ variant: 'resend', firstName, pin, verifyLink: `${siteUrl}/?verify_email=${verifyToken}` })
  await sendEmail(toEmail, pinEmailSubject(pin), html)
}
