import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
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
interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

interface NewRecipient {
  phone: string
  params?: string[]
  header_params?: import('@/lib/whatsapp/meta-api').TemplateHeaderParam[]
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id
    const supabase = createAdminClient()

    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      header_params,
    } = body

    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const { data: templateMeta } = await supabase
      .from('message_templates')
      .select('header_type, body_text')
      .match({
        user_id: userId,
        name: template_name,
        language: template_language || 'en_US',
      })
      .maybeSingle()

    if (templateMeta && ['image', 'video', 'document'].includes(templateMeta.header_type || '')) {
      const hasHeaderParams = Array.isArray(header_params) && header_params.length > 0
      const hasRecipientHeaderParams = Array.isArray(newRecipients) && newRecipients.some((r: NewRecipient) => Array.isArray(r.header_params) && r.header_params.length > 0)
      if (!hasHeaderParams && !hasRecipientHeaderParams) {
        return NextResponse.json(
          {
            error:
              `Template "${template_name}" has a ${templateMeta.header_type} header that requires a media URL. ` +
              'Go to the Personalize step and provide a publicly accessible URL for the header media.',
          },
          { status: 400 },
        )
      }
    }

    if (templateMeta) {
      const namedParams = templateMeta.body_text.match(/\{\{([a-zA-Z_]\w*)\}\}/g)
      if (namedParams && namedParams.length > 0) {
        return NextResponse.json(
          {
            error:
              `Template "${template_name}" uses named parameters (${namedParams.join(', ')}) which is not supported. ` +
              'Create a template with positional parameters ({{1}}, {{2}}, etc.) instead.',
          },
          { status: 400 },
        )
      }
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (!config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[broadcast] Token decryption failed:', err)
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

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      if (request.signal.aborted) {
        console.warn('[broadcast] request aborted by client, stopping')
        break
      }
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: template_name,
            language: template_language || 'en_US',
            params: recipient.params ?? [],
            headerParams: recipient.header_params ?? header_params,
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
