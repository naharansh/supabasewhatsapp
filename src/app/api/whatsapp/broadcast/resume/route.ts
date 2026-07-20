import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTemplateMessage, type TemplateHeaderParam } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'

interface VariableMapping {
  type: 'static' | 'field' | 'custom_field'
  value: string
}

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 100

function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: { name?: string; phone?: string; email?: string; company?: string },
  customValues?: Map<string, string>,
): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a)
    const bn = Number(b)
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
    return a.localeCompare(b)
  })

  return keys.map((key) => {
    const v = variables[key]
    if (v.type === 'static') return v.value
    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      }
      return fieldMap[v.value] ?? ''
    }
    return customValues?.get(v.value) ?? ''
  })
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id
    const supabase = createAdminClient()

    const body = await request.json()
    const { broadcast_id, batch_size } = body

    if (!broadcast_id) {
      return NextResponse.json(
        { error: 'broadcast_id is required' },
        { status: 400 },
      )
    }

    const batchSize = Math.min(
      Math.max(Number(batch_size) || DEFAULT_BATCH_SIZE, 1),
      MAX_BATCH_SIZE,
    )

    const { data: broadcast, error: bcError } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('id', broadcast_id)
      .eq('user_id', userId)
      .single()

    if (bcError || !broadcast) {
      return NextResponse.json(
        { error: 'Broadcast not found' },
        { status: 404 },
      )
    }

    if (broadcast.status === 'sent') {
      return NextResponse.json(
        { error: 'Broadcast already completed' },
        { status: 400 },
      )
    }

    const { data: pendingRecipients, error: recsError } = await supabase
      .from('broadcast_recipients')
      .select('*, contact:contacts(*)')
      .eq('broadcast_id', broadcast_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(batchSize)

    if (recsError) {
      return NextResponse.json(
        { error: 'Failed to fetch pending recipients' },
        { status: 500 },
      )
    }

    if (!pendingRecipients || pendingRecipients.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending recipients to resume',
        sent: 0,
        failed: 0,
        processed: 0,
        remaining: 0,
      })
    }

    const { count: totalRemaining } = await supabase
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcast_id)
      .eq('status', 'pending')

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json(
        { error: 'WhatsApp access token is corrupted. Reset in Settings.' },
        { status: 400 },
      )
    }

    const variables = (broadcast.template_variables ?? {}) as Record<string, VariableMapping>
    const hasVariables = Object.keys(variables).length > 0

    let headerParams: TemplateHeaderParam[] | undefined
    const { data: templateMeta } = await supabase
      .from('message_templates')
      .select('header_type, header_content')
      .match({ user_id: userId, name: broadcast.template_name, language: broadcast.template_language || 'en_US' })
      .maybeSingle()

    if (templateMeta?.header_type && ['image', 'video', 'document'].includes(templateMeta.header_type)) {
      const url = (broadcast as Record<string, unknown>).header_content as string | undefined || templateMeta.header_content
      if (url) {
        const headerType = templateMeta.header_type as 'image' | 'video' | 'document'
        headerParams = [{ type: headerType, [headerType]: { link: url } }] as TemplateHeaderParam[]
      }
    }

    const customValueIndex: Map<string, Map<string, string>> = new Map()
    if (hasVariables) {
      const contactIds = pendingRecipients
        .map((r) => r.contact?.id)
        .filter((id): id is string => Boolean(id))

      if (contactIds.length > 0) {
        const { data: customValues } = await supabase
          .from('contact_custom_values')
          .select('contact_id, custom_field_id, value')
          .in('contact_id', contactIds)

        if (customValues) {
          for (const row of customValues) {
            const bucket = customValueIndex.get(row.contact_id) ?? new Map<string, string>()
            bucket.set(row.custom_field_id, row.value ?? '')
            customValueIndex.set(row.contact_id, bucket)
          }
        }
      }
    }

    let sentCount = 0
    let failedCount = 0

    for (const recipient of pendingRecipients) {
      if (request.signal.aborted) {
        console.warn('[broadcast/resume] request aborted by client, stopping')
        break
      }
      const contact = recipient.contact

      if (!contact?.phone) {
        failedCount++
        await supabase
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: 'No phone number on contact' })
          .eq('id', recipient.id)
        continue
      }

      const sanitized = sanitizePhoneForMeta(contact.phone)

      if (!isValidE164(sanitized)) {
        failedCount++
        await supabase
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: 'Invalid phone number format' })
          .eq('id', recipient.id)
        continue
      }

      const params = hasVariables
        ? resolveVariables(variables, contact, customValueIndex.get(contact.id))
        : []

      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: broadcast.template_name,
            language: broadcast.template_language || 'en_US',
            params,
            headerParams,
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
        }
      }

      if (sentMessageId) {
        sentCount++
        await supabase
          .from('broadcast_recipients')
          .update({ whatsapp_message_id: sentMessageId })
          .eq('id', recipient.id)

        await supabase
          .from('broadcast_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            error_message: null,
          })
          .eq('id', recipient.id)
          .eq('status', 'pending')
      } else {
        failedCount++
        await supabase
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            error_message: lastError || 'Unknown error',
          })
          .eq('id', recipient.id)
      }
    }

    const processed = sentCount + failedCount
    const remaining = Math.max(0, (totalRemaining ?? 0) - processed)

    if (remaining === 0) {
      const { data: allRecipients } = await supabase
        .from('broadcast_recipients')
        .select('status')
        .eq('broadcast_id', broadcast_id)

      const allFailed = allRecipients?.every(
        (r) => r.status === 'failed' || r.status === 'pending',
      )
      await supabase
        .from('broadcasts')
        .update({ status: allFailed ? 'failed' : 'sent' })
        .eq('id', broadcast_id)
    }

    return NextResponse.json({
      success: true,
      sent: sentCount,
      failed: failedCount,
      processed,
      remaining,
    })
  } catch (error) {
    console.error('Error in broadcast resume:', error)
    return NextResponse.json(
      { error: 'Failed to resume broadcast' },
      { status: 500 },
    )
  }
}
