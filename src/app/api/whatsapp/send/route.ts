import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = session.user.id
    const supabase = createAdminClient()

    const { data: sProfile } = await supabase
      .from('profiles')
      .select('message_limit')
      .eq('user_id', userId)
      .maybeSingle()

    const msgLimit = sProfile?.message_limit ?? 0
    if (msgLimit > 0) {
      const [{ data: convIds, error: convErr }, { data: userBroadcasts, error: bcErr }] = await Promise.all([
        supabase.from('conversations').select('id').eq('user_id', userId),
        supabase.from('broadcasts').select('id').eq('user_id', userId),
      ])

      if (convErr || bcErr) {
        console.error('[send] Failed to fetch conversations/broadcasts for limit check:', convErr ?? bcErr)
        return NextResponse.json({ error: 'Database error checking message limit' }, { status: 500 })
      }

      const convIdList = convIds?.map(c => c.id) ?? []
      const broadcastIdList = userBroadcasts?.map(b => b.id) ?? []

      const [agentResult, broadcastResult] = await Promise.all([
        convIdList.length > 0
          ? supabase.from('messages').select('id', { count: 'exact', head: true }).eq('sender_type', 'agent').in('conversation_id', convIdList)
          : Promise.resolve({ count: 0, error: null }),
        broadcastIdList.length > 0
          ? supabase.from('broadcast_recipients').select('id', { count: 'exact', head: true }).in('broadcast_id', broadcastIdList).in('status', ['sent', 'delivered', 'read'])
          : Promise.resolve({ count: 0, error: null }),
      ])

      if (agentResult.error || broadcastResult.error) {
        console.error('[send] Count query failed:', agentResult.error ?? broadcastResult.error)
        return NextResponse.json({ error: 'Database error checking message count' }, { status: 500 })
      }

      const totalSent = (agentResult.count ?? 0) + (broadcastResult.count ?? 0)
      if (totalSent >= msgLimit) {
        return NextResponse.json(
          { error: `Message limit of ${msgLimit} exceeded. Cannot send more messages.` },
          { status: 403 }
        )
      }
    }

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      template_name,
      template_params,
      header_params,
      reply_to_message_id,
    } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    if (message_type === 'text' && !content_text) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      )
    }

    if (message_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      )
    }

    let tplLanguage: string | null = null
    if (message_type === 'template' && template_name) {
      const { data: tpl } = await supabase
        .from('message_templates')
        .select('header_type, language')
        .eq('user_id', userId)
        .eq('name', template_name)
        .maybeSingle()
      if (tpl) tplLanguage = tpl.language
      if (tpl && ['image', 'video', 'document'].includes(tpl.header_type || '')) {
        const hasHeaderParams = Array.isArray(header_params) && header_params.length > 0
        if (!hasHeaderParams) {
          return NextResponse.json(
            {
              error:
                `Template "${template_name}" has a ${tpl.header_type} header that requires a media URL. ` +
                'Provide a publicly accessible URL for the header media.',
            },
            { status: 400 },
          )
        }
      }
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', conversation_id)
      .maybeSingle()

    if (convError || !conversation || conversation.user_id !== userId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = conversation.contact
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      )
    }

    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
        { status: 400 }
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/send] Token decryption failed:', err)
      return NextResponse.json(
        {
          error:
            'WhatsApp configuration is corrupted — the stored access token cannot be decrypted. ' +
            'Go to Settings → WhatsApp Integration, click "Reset Configuration", then re-save.',
          needs_reset: true,
        },
        { status: 400 },
      )
    }

    if (isLegacyFormat(config.access_token)) {
      supabase
        .from('whatsapp_config')
        .update({ access_token: encrypt(accessToken) })
        .eq('id', config.id)
        .then(() => undefined, (err: unknown) => {
          console.warn(
            '[whatsapp/send] access_token GCM upgrade failed:',
            err instanceof Error ? err.message : err,
          )
        })
    }

    let contextMessageId: string | undefined
    if (reply_to_message_id) {
      const { data: parent } = await supabase
        .from('messages')
        .select('id, message_id, conversation_id')
        .eq('id', reply_to_message_id)
        .maybeSingle()

      if (!parent || parent.conversation_id !== conversation_id) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        )
      }
      if (!parent.message_id) {
        console.warn(
          '[whatsapp/send] reply target has no Meta message_id; sending without context'
        )
      } else {
        contextMessageId = parent.message_id
      }
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone

    const attempt = async (phone: string): Promise<string> => {
      if (message_type === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          templateName: template_name,
          language: tplLanguage || 'en_US',
          params: template_params || [],
          headerParams: header_params,
          contextMessageId,
        })
        return result.messageId
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text: content_text,
        contextMessageId,
      })
      return result.messageId
    }

    try {
      const variants = phoneVariants(sanitizedPhone)
      let lastError: unknown = null

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant)
          workingPhone = variant
          lastError = null
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (!isRecipientNotAllowedError(message)) {
            throw err
          }
          lastError = err
          console.warn(`[whatsapp/send] variant "${variant}" rejected by Meta, trying next\u2026`)
        }
      }

      if (lastError) throw lastError
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API send failed for all variants:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 }
      )
    }

    if (workingPhone !== sanitizedPhone) {
      console.log(
        `[whatsapp/send] Auto-corrected contact phone: ${sanitizedPhone} \u2192 ${workingPhone}`
      )
      await supabase
        .from('contacts')
        .update({ phone: workingPhone })
        .eq('id', contact.id)
    }

    const { data: messageRecord } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        sender_type: 'agent',
        content_type: message_type,
        content_text: content_text || null,
        media_url: media_url || null,
        template_name: template_name || null,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: reply_to_message_id || null,
      })
      .select()
      .single()

    await supabase
      .from('conversations')
      .update({
        last_message_text: content_text || `[${message_type}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation_id)

    try {
      await supabase
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .match({ user_id: userId, contact_id: contact.id, status: 'active' })
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send failed:',
        err instanceof Error ? err.message : err,
      )
    }

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
    })
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
