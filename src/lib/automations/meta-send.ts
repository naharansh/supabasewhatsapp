import { sendTextMessage, sendTemplateMessage, type TemplateHeaderParam } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { createAdminClient } from '@/lib/supabase/admin'

interface SendTextArgs {
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
  headerParams?: TemplateHeaderParam[]
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const admin = createAdminClient()

  const { data: contact } = await admin.from('contacts')
    .select('id, phone')
    .match({ id: input.contactId, user_id: input.userId })
    .maybeSingle()

  if (!contact?.phone) {
    throw new Error('contact not found for this user')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config } = await admin.from('whatsapp_config')
    .select('*')
    .eq('user_id', input.userId)
    .single()

  if (!config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        params: input.params,
        headerParams: input.headerParams,
      })
      return r.messageId
    }
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }

  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await admin.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  const content_type = input.kind === 'template' ? 'template' : 'text'
  const content_text = input.kind === 'text' ? input.text : null
  const template_name = input.kind === 'template' ? input.templateName : null

  try {
    await admin.from('messages').insert({
      conversation_id: input.conversationId,
      sender_type: 'bot',
      content_type: content_type,
      content_text: content_text,
      template_name: template_name,
      message_id: waMessageId,
      status: 'sent',
    }).select().single()
  } catch (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${(msgErr as Error).message}`)
  }

  await admin.from('conversations').update({
    last_message_text:
      input.kind === 'template' ? `[template:${input.templateName}]` : input.text,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
