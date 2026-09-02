import { NextResponse } from 'next/server'
import {
  resolveConfigByUserId,
  verifyChallengeForUser,
  handleWebhookPost,
} from '../webhook-core'

// Per-user webhook callback: /api/whatsapp/webhook/[userId]
//
// Each user configures this URL in their Meta WhatsApp webhook settings.
// The user_id in the URL scope resolves the config directly (no ambiguity
// from duplicate phone_number_id rows across users).

type Params = { params: Promise<{ userId: string }> }

// GET - Webhook verification, scoped to the URL's user
export async function GET(request: Request, context: Params) {
  try {
    const { userId } = await context.params

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

    const matched = await verifyChallengeForUser(userId, verifyToken)

    if (matched) {
      // Webhook was just verified — make sure the config is marked
      // connected so the settings UI reflects an active callback.
      await resolveConfigByUserId(userId)
      // Return challenge as plain text
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
    console.error('Error in per-user webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages, scoped to the URL's user
export async function POST(request: Request, context: Params) {
  try {
    const { userId } = await context.params

    const config = await resolveConfigByUserId(userId)

    if (!config) {
      console.error('No config found for user_id:', userId)
      return NextResponse.json(
        { error: 'No WhatsApp configuration for this user' },
        { status: 404 }
      )
    }

    return handleWebhookPost(request, config)
  } catch (error) {
    console.error('Error in per-user webhook POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
