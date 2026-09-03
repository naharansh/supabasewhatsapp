import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const supabase = createAdminClient()

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, waba_id, access_token, status, meta_app_secret')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) throw error

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          config: null,
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          config: { phone_number_id: config.phone_number_id, waba_id: config.waba_id },
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      return NextResponse.json({
        connected: true,
        phone_info: phoneInfo,
        config: {
          phone_number_id: config.phone_number_id,
          waba_id: config.waba_id,
          has_meta_app_secret: !!config.meta_app_secret,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          config: { phone_number_id: config.phone_number_id, waba_id: config.waba_id },
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
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
    const { phone_number_id, waba_id, access_token, verify_token, meta_app_secret } = body

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during save:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      )
    }

    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null = null
    let encryptedMetaAppSecret: string | null = null
    // Distinguish "field omitted" (preserve existing) from "cleared"
    // (explicit null / empty string). The client omits `verify_token` when
    // it must keep the stored one, and sends null to clear it.
    const verifyTokenProvided =
      Object.prototype.hasOwnProperty.call(body, 'verify_token')
    const metaAppSecretProvided =
      Object.prototype.hasOwnProperty.call(body, 'meta_app_secret')
    try {
      encryptedAccessToken = encrypt(access_token)
      if (verifyTokenProvided && verify_token != null && verify_token !== '') {
        encryptedVerifyToken = encrypt(verify_token)
      }
      if (metaAppSecretProvided && meta_app_secret != null && meta_app_secret !== '') {
        encryptedMetaAppSecret = encrypt(meta_app_secret)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      )
    }

    const { data: existing, error: findError } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()

    if (findError) throw findError

    if (existing) {
      const update: Record<string, unknown> = {
        phone_number_id,
        waba_id: waba_id || null,
        access_token: encryptedAccessToken,
        status: 'connected',
        connected_at: new Date(),
        updated_at: new Date(),
      }
      // Only touch the encrypted secrets when the client explicitly sent
      // them (either a new value or an explicit null to clear). Omitting the
      // field preserves the previously stored token/secret.
      if (verifyTokenProvided) update.verify_token = encryptedVerifyToken
      if (metaAppSecretProvided) update.meta_app_secret = encryptedMetaAppSecret

      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(update)
        .eq('user_id', userId)

      if (updateError) throw updateError
    } else {
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          user_id: userId,
          phone_number_id,
          waba_id: waba_id || null,
          access_token: encryptedAccessToken,
          verify_token: encryptedVerifyToken,
          meta_app_secret: encryptedMetaAppSecret,
          status: 'connected',
          connected_at: new Date(),
        })
        .select()
        .single()

      if (insertError) throw insertError
    }

    return NextResponse.json({ success: true, phone_info: phoneInfo })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('user_id', userId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
