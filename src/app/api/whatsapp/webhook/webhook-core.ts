import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getMediaUrl } from '@/lib/whatsapp/meta-api'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'

const supabase = createAdminClient()

export interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  context?: { id: string }
}

export interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
      }>
    }
    field: string
  }>
}

export interface WebhookConfig {
  user_id: string
  access_token: string
  meta_app_secret?: string | null
}

/**
 * Resolve the receiving user's config from a per-user webhook URL.
 * Uses the URL's user_id to directly fetch that user's config — no
 * ambiguous phone_number_id lookup, so duplicate phone_number_id rows
 * across users can never break this path.
 *
 * If the user saved a per-user `meta_app_secret` (for a different Meta
 * App), it is decrypted and returned in the config so signature
 * verification uses the correct signing key.
 */
export async function resolveConfigByUserId(userId: string): Promise<WebhookConfig | null> {
  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (!config) return null
  let metaAppSecret: string | null = null
  if (config.meta_app_secret) {
    try {
      metaAppSecret = decrypt(config.meta_app_secret)
    } catch {
      console.warn('[webhook] Failed to decrypt meta_app_secret for user', userId, '— falling back to global META_APP_SECRET')
    }
  }
  return {
    user_id: config.user_id,
    access_token: config.access_token,
    meta_app_secret: metaAppSecret,
  }
}

/**
 * Resolve the receiving user's config from the legacy shared webhook
 * URL using the phone_number_id carried in the Meta payload.
 */
export async function resolveConfigByPhoneNumberId(phoneNumberId: string): Promise<WebhookConfig | null> {
  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('phone_number_id', phoneNumberId)
    .limit(1)
    .maybeSingle()
  if (!config) return null
  let metaAppSecret: string | null = null
  if (config.meta_app_secret) {
    try {
      metaAppSecret = decrypt(config.meta_app_secret)
    } catch {
      console.warn('[webhook] Failed to decrypt meta_app_secret for phone_number_id', phoneNumberId, '— falling back to global META_APP_SECRET')
    }
  }
  return {
    user_id: config.user_id,
    access_token: config.access_token,
    meta_app_secret: metaAppSecret,
  }
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

export async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
}) {
  try {
    await supabase
      .from('messages')
      .update({ status: status.status })
      .eq('message_id', status.id)
  } catch (msgErr) {
    console.error('Error updating message status:', msgErr)
  }

  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString()

  let recipient: { id: string; status: string } | null = null
  try {
    const { data } = await supabase
      .from('broadcast_recipients')
      .select('id, status')
      .eq('whatsapp_message_id', status.id)
      .maybeSingle()
    recipient = data
  } catch (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr)
  }

  if (!recipient) return

  if (!isValidStatusTransition(recipient.status, status.status)) return

  const update: Record<string, unknown> = { status: status.status, error_message: null }
  if (status.status === 'sent') update.sent_at = tsIso
  if (status.status === 'delivered') update.delivered_at = tsIso
  if (status.status === 'read') update.read_at = tsIso

  try {
    await supabase
      .from('broadcast_recipients')
      .update(update as { status: string; sent_at?: string; delivered_at?: string; read_at?: string })
      .eq('id', recipient.id)
  } catch (recUpdateErr) {
    console.error('Error updating broadcast recipient status:', recUpdateErr)
  }
}

async function flagBroadcastReplyIfAny(userId: string, contactId: string) {
  try {
    const { data: userBroadcasts } = await supabase
      .from('broadcasts')
      .select('id')
      .eq('user_id', userId)

    if (!userBroadcasts?.length) return

    const broadcastIds = userBroadcasts.map(b => b.id)

    const { data: row } = await supabase
      .from('broadcast_recipients')
      .select('*')
      .eq('contact_id', contactId)
      .in('status', ['sent', 'delivered', 'read'])
      .in('broadcast_id', broadcastIds)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!row) return

    await supabase
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  return data?.id ?? null
}

async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  if (!reaction.emoji) {
    try {
      await supabase
        .from('message_reactions')
        .delete()
        .match({
          message_id: targetInternalId,
          actor_type: 'customer',
          actor_id: contactId,
        })
    } catch (e) {
      console.error('[webhook] reaction delete failed:', (e as Error).message)
    }
    return
  }

  try {
    const { error } = await supabase
      .from('message_reactions')
      .upsert(
        {
          message_id: targetInternalId,
          conversation_id: conversationId,
          actor_type: 'customer',
          actor_id: contactId,
          emoji: reaction.emoji,
        },
        { onConflict: 'message_id,actor_type,actor_id' }
      )
    if (error) throw error
  } catch (e) {
    console.error('[webhook] reaction upsert failed:', (e as Error).message)
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  userId: string,
  accessToken: string
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  const contactOutcome = await findOrCreateContact(
    userId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  const conversation = await findOrCreateConversation(
    userId,
    contactRecord.id
  )
  if (!conversation) return

  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, accessToken)

  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        message.context.id
      )
    }
  }

  void mediaType

  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text'

  const { count: priorCustomerMsgCount } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')

  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  let createdMessage: { id: string } | null = null
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: message.id,
        status: 'delivered',
        created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
        reply_to_message_id: replyToInternalId,
        interactive_reply_id: interactiveReplyId,
      })
      .select()
      .single()
    if (error) {
      // Log the real Postgres error so a schema mismatch (e.g. missing
      // reply_to_message_id / interactive_reply_id columns or an
      // out-of-date content_type CHECK) is visible in server logs instead
      // of being silently swallowed — a failed INSERT here is exactly why
      // an inbound WhatsApp message never reaches the inbox.
      console.error(
        '[webhook] messages INSERT failed for inbound message',
        {
          meta_message_id: message.id,
          conversation_id: conversation.id,
          content_type: contentType,
          error: error.message,
          details: error.details,
          hint: error.hint,
        },
      )
    } else {
      createdMessage = data
    }
  } catch (e) {
    console.error('Error inserting message:', e)
  }

  if (!createdMessage) return

  try {
    await supabase
      .from('conversations')
      .update({
        last_message_text: contentText || `[${message.type}]`,
        last_message_at: new Date().toISOString(),
        unread_count: (conversation.unread_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
  } catch (convError) {
    console.error('Error updating conversation:', convError)
  }

  await flagBroadcastReplyIfAny(userId, contactRecord.id)

  const flowResult = await dispatchInboundToFlows({
    userId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: message.id,
          }
        : {
            kind: 'text',
            text: contentText ?? message.text?.body ?? '',
            meta_message_id: message.id,
          },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const inboundText = contentText ?? message.text?.body ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      userId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  interactiveReplyId: string | null
}> {
  const verifyAndBuildUrl = async (
    mediaId: string
  ): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken })
      return `/api/whatsapp/media/${mediaId}`
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      )
      return null
    }
  }

  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return empty

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  wasCreated: boolean
}

async function findOrCreateContact(
  userId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)

  const existingContact = contacts?.find((c: ContactRow) => phonesMatch(c.phone, phone))

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await supabase
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }

  const { data: newContact } = await supabase
    .from('contacts')
    .insert({
      user_id: userId,
      phone,
      name: name || phone,
    })
    .select()
    .single()

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(userId: string, contactId: string) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .match({ user_id: userId, contact_id: contactId })
    .maybeSingle()

  if (existing) {
    return existing
  }

  const { data: newConv } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      contact_id: contactId,
    })
    .select()
    .single()

  return newConv
}

/**
 * Process a webhook body for a given owner user. When `config` is
 * provided (from a per-user URL), the caller has already resolved the
 * user and config; otherwise it is looked up by phone_number_id (legacy
 * shared URL path).
 */
export async function processWebhookForUser(
  body: { entry?: WhatsAppWebhookEntry[] },
  config: WebhookConfig | null,
) {
  if (!body.entry) return
  if (!config) return

  let decryptedAccessToken: string
  try {
    decryptedAccessToken = decrypt(config.access_token)
  } catch (err) {
    console.error('[webhook] Token decryption failed:', err)
    return
  }

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      const value = change.value

      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      if (!value.messages || !value.contacts) continue

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          config.user_id,
          decryptedAccessToken
        )
      }
    }
  }
}

/**
 * Verify a webhook GET challenge for a specific user (per-user URL) by
 * comparing against that user's stored verify_token.
 */
export async function verifyChallengeForUser(
  userId: string,
  verifyToken: string | null
): Promise<boolean> {
  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (!config || !config.verify_token || !verifyToken) {
    return false
  }

  try {
    if (decrypt(config.verify_token) === verifyToken) {
      // Opportunistic GCM upgrade for legacy tokens.
      if (isLegacyFormat(config.verify_token)) {
        supabase
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', config.id)
          .then(() => undefined, (error: unknown) => {
            console.warn('[webhook] verify_token GCM upgrade failed:', error)
          })
      }
      return true
    }
  } catch {
    // Malformed token row — treat as no match.
  }

  return false
}

/**
 * Verify a webhook GET challenge across all users (legacy shared URL).
 * Matches any user's verify_token.
 */
export async function verifyChallengeAnyUser(verifyToken: string | null) {
  const configs = await supabase
    .from('whatsapp_config')
    .select('id, verify_token')

  for (const config of configs.data ?? []) {
    if (!config.verify_token) continue
    try {
      if (decrypt(config.verify_token) === verifyToken) {
        if (isLegacyFormat(config.verify_token)) {
          supabase
            .from('whatsapp_config')
            .update({ verify_token: encrypt(verifyToken) })
            .eq('id', config.id)
            .then(() => undefined, (error: unknown) => {
              console.warn('[webhook] verify_token GCM upgrade failed:', error)
            })
        }
        return true
      }
    } catch {
      // skip malformed
    }
  }
  return false
}

/**
 * Shared POST handler logic. Verifies the HMAC signature, parses the
 * body, then processes messages for the resolved config.
 */
export async function handleWebhookPost(
  request: Request,
  config: WebhookConfig | null
) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature, config?.meta_app_secret ?? undefined)) {
    console.warn('[webhook] rejected request with invalid signature', {
      user_id: config?.user_id,
      has_per_user_secret: !!config?.meta_app_secret,
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  processWebhookForUser(body, config).catch((error) => {
    console.error('Error processing webhook:', error)
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
