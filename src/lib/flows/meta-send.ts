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
import { recordFlowError } from './logging'

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

  const { data: contact, error: contactErr } = await admin.from('contacts')
    .select('id, phone')
    .match({ id: args.contactId, user_id: args.userId })
    .maybeSingle()

  if (contactErr) {
    throw new Error(`contact lookup failed: ${contactErr.message}`)
  }
  if (!contact?.phone) {
    throw new Error('contact not found for this user')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await admin.from('whatsapp_config')
    .select('*')
    .eq('user_id', args.userId)
    .single()

  if (configErr) {
    throw new Error(`whatsapp_config lookup failed: ${configErr.message}`)
  }
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

  // Non-fatal: the message already reached Meta. A failed persistence here
  // means the bubble is missing from the thread, but failing the run would
  // strand the customer mid-conversation — log loudly instead.
  const { error: msgErr } = await admin.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: waMessageId,
    status: 'sent',
  }).select().single()
  if (msgErr) {
    await recordFlowError({
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      code: 'MESSAGE_INSERT_FAILED',
      message: 'bot text message insert failed after Meta send',
      detail: msgErr.message,
      extra: { whatsapp_message_id: waMessageId, phone: workingPhone, content_type: 'text' },
    })
  }

  const { error: convErr } = await admin.from('conversations').update({
    last_message_text: args.text,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', args.conversationId)
  if (convErr) {
    await recordFlowError({
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      code: 'CONVERSATION_UPDATE_FAILED',
      message: 'conversations.update(last_message) failed',
      detail: convErr.message,
      extra: { whatsapp_message_id: waMessageId },
    })
  }

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

  const { data: contact, error: contactErr } = await admin.from('contacts')
    .select('id, phone')
    .match({ id: input.contactId, user_id: input.userId })
    .maybeSingle()

  if (contactErr) {
    throw new Error(`contact lookup failed: ${contactErr.message}`)
  }
  if (!contact?.phone) {
    throw new Error('contact not found for this user')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await admin.from('whatsapp_config')
    .select('*')
    .eq('user_id', input.userId)
    .single()

  if (configErr) {
    throw new Error(`whatsapp_config lookup failed: ${configErr.message}`)
  }
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

  // Non-fatal: the message already reached Meta. A failed persistence here
  // means the bubble is missing from the thread, but failing the run would
  // strand the customer mid-conversation — log loudly instead.
  const { error: msgErr } = await admin.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: input.bodyText,
    message_id: waMessageId,
    status: 'sent',
  }).select().single()
  if (msgErr) {
    await recordFlowError({
      userId: input.userId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      code: 'MESSAGE_INSERT_FAILED',
      message: 'bot interactive message insert failed after Meta send',
      detail: msgErr.message,
      extra: { whatsapp_message_id: waMessageId, phone: workingPhone, content_type: 'interactive', kind: input.kind },
    })
  }

  const { error: convErr } = await admin.from('conversations').update({
    last_message_text: input.bodyText,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', input.conversationId)
  if (convErr) {
    await recordFlowError({
      userId: input.userId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      code: 'CONVERSATION_UPDATE_FAILED',
      message: 'conversations.update(last_message) failed',
      detail: convErr.message,
      extra: { whatsapp_message_id: waMessageId },
    })
  }

  return { whatsapp_message_id: waMessageId }
}
