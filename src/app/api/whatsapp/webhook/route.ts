import { NextResponse } from 'next/server'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import {
  resolveConfigByPhoneNumberId,
  verifyChallengeAnyUser,
  processWebhookForUser,
  type WhatsAppWebhookEntry,
} from './webhook-core'

// Legacy shared webhook callback: /api/whatsapp/webhook
//
// Kept for backward compatibility. New installs should use the per-user
// URL: /api/whatsapp/webhook/[userId].
//
// For the shared URL, the owner is resolved from the phone_number_id
// carried in the Meta payload. If multiple users share a phone_number_id,
// we take the first config row deterministically (.limit(1)) instead of
// failing on ambiguous matches.

// GET - Webhook verification (matches ANY user's verify_token)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    const matched = await verifyChallengeAnyUser(verifyToken)

    if (matched) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages, resolve owner by phone_number_id
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify and inspect the payload.
  const rawBody = await request.text()

  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Resolve the owner from the payload's phone_number_id.
  let phoneNumberId: string | null = null
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes) {
      if (change.value?.metadata?.phone_number_id) {
        phoneNumberId = change.value.metadata.phone_number_id
      }
    }
  }

  let config: { user_id: string; access_token: string } | null = null
  if (phoneNumberId) {
    config = await resolveConfigByPhoneNumberId(phoneNumberId)
    if (!config) {
      console.error('No config found for phone_number_id:', phoneNumberId)
    }
  }

  // Process asynchronously so we can ack Meta within their timeout.
  processWebhookForUser(body, config).catch((error) => {
    console.error('Error processing webhook:', error)
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
