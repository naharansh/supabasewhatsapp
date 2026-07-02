import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { createAdminClient } from '@/lib/supabase/admin'

interface SendTextEngineArgs {
  userId: string
  conversationId: string
  contactId: string
  text: string
}

export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const admin = createAdminClient()

  const { data: contact } = await admin.from('contacts')
    .select('id, phone')
    .match({ id: args.contactId, user_id: args.userId })
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
    .eq('user_id', args.userId)
    .single()

  if (!config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: args.text,
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

  try {
    await admin.from('messages').insert({
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: 'text',
      content_text: args.text,
      message_id: waMessageId,
      status: 'sent',
    }).select().single()
  } catch (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${(msgErr as Error).message}`)
  }

  await admin.from('conversations').update({
    last_message_text: args.text,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
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
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: input.bodyText,
        buttons: input.buttons,
        headerText: input.headerText,
        footerText: input.footerText,
      })
      return r.messageId
    }
    const r = await sendInteractiveList({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      sections: input.sections,
      headerText: input.headerText,
      footerText: input.footerText,
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

  try {
    await admin.from('messages').insert({
      conversation_id: input.conversationId,
      sender_type: 'bot',
      content_type: 'interactive',
      content_text: input.bodyText,
      message_id: waMessageId,
      status: 'sent',
    }).select().single()
  } catch (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${(msgErr as Error).message}`)
  }

  await admin.from('conversations').update({
    last_message_text: input.bodyText,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
