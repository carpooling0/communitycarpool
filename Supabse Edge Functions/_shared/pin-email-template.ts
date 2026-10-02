// ── PIN email template (pure, no imports) ─────────────────────────────────────
// One builder for both the first PIN email and the resend. Kept free of imports
// so it can be rendered and tested outside the edge runtime.
//
// Copy-friendliness:
//   * the code is ONE element (not one box per digit), so a tap, double-tap or
//     long-press selects all six digits at once and nothing stray is copied
//   * the code is also in the subject and the preheader, so it shows in the
//     inbox list and on the lock screen, and mail apps can offer to autofill it
//   * a one-tap "Confirm My Journey" button works without typing anything

import { escapeHtml } from './security.ts'

export type PinEmailVariant = 'initial' | 'resend'

export function pinEmailSubject(pin: string): string {
  return `${pin} is your Community Carpool verification code`
}

export function buildPinEmailHtml(opts: {
  variant: PinEmailVariant
  firstName: string
  pin: string
  verifyLink: string
}): string {
  const { variant, firstName, pin, verifyLink } = opts
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN must be exactly 6 digits')

  const name = escapeHtml(firstName || 'there')
  const link = escapeHtml(verifyLink)
  const isResend = variant === 'resend'
  const title = isResend ? 'Your New Code' : 'Almost There!'
  const subtitle = isResend
    ? `Hi ${name} — here is your new verification code.`
    : `Hi ${name} — one code stands between you and your carpool match.`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${pinEmailSubject(pin)}</title>
</head>
<body style="margin:0;padding:0;background:#F0F0ED;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Your verification code is ${pin}. It expires in 15 minutes.&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0F0ED;">
<tr><td align="center" style="padding:32px 16px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">

    <tr>
      <td align="center" style="padding-bottom:20px;">
        <a href="https://communitycarpool.org" style="text-decoration:none;">
          <img src="https://communitycarpool.org/logo-slogan.png" alt="Community Carpool" style="height:48px;width:auto;display:block;margin:0 auto;" />
        </a>
      </td>
    </tr>

    <tr>
      <td style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,0.08);">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td style="background:#1B5C3A;padding:20px 28px 18px;border-radius:14px 14px 0 0;text-align:center;">
              <h1 style="margin:0;font-size:20px;font-weight:900;color:#FFFFFF;font-family:Montserrat,Inter,sans-serif;">${title}</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#B4E035;">${subtitle}</p>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 28px 8px;text-align:center;">
              <p style="margin:0 0 12px;font-size:13px;color:#6B7280;">Your verification code</p>

              <!-- ONE element: tap or long-press selects all six digits -->
              <div style="margin:0 auto 10px;max-width:300px;padding:16px 8px;border:2.5px solid #1B5C3A;border-radius:12px;background:#f0fdf4;text-align:center;font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;font-size:42px;line-height:1.1;font-weight:800;letter-spacing:10px;text-indent:10px;color:#1B5C3A;-webkit-user-select:all;user-select:all;">${pin}</div>
              <p style="margin:0 0 4px;font-size:12px;color:#9CA3AF;">Tap and hold the code to copy it, then paste it into the page.</p>
              <p style="margin:0 0 20px;font-size:12px;color:#9CA3AF;">Expires in 15 minutes.</p>

              <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #E5E7EB;padding-bottom:18px;"></td></tr></table>

              <p style="margin:0 0 12px;font-size:13px;color:#6B7280;">Or skip the code. One tap confirms your journey:</p>
              <a href="${link}" style="display:inline-block;padding:13px 32px;background:#1B5C3A;color:#FFFFFF;border-radius:50px;text-decoration:none;font-size:15px;font-weight:700;font-family:Montserrat,Inter,sans-serif;">Confirm My Journey &rarr;</a>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 28px 26px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.5;">Never share this code with anyone. Community Carpool will never ask you for it.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding-top:20px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#9CA3AF;">Community Carpool &middot; communitycarpool.org</p>
        <p style="margin:4px 0 0;font-size:12px;color:#D1D5DB;">If you did not request this, you can safely ignore this email.</p>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body></html>`
}
