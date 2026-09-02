import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   If no per-user `secret` is provided, `META_APP_SECRET` env var is
 *   used as fallback. If neither is available we fail closed — every
 *   request is rejected until the operator configures a secret.
 *
 * Multi-tenant note:
 *   Users on different Meta Apps each have their own App Secret. Pass
 *   the per-user `secret` (decrypted from `whatsapp_config.meta_app_secret`)
 *   when available so we verify against the correct signing key.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret?: string,
): boolean {
  const appSecret = secret ?? process.env.META_APP_SECRET
  if (!appSecret) {
    console.error(
      '[webhook] META_APP_SECRET is not set and no per-user secret provided — rejecting request. ' +
        'Configure the env var (Meta → App Settings → Basic → App Secret) ' +
        'or save your Meta App Secret in Settings → WhatsApp Integration.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
