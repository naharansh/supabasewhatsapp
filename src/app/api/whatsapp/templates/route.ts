import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const supabase = createAdminClient()

    const { data: templates, error } = await supabase
      .from('message_templates')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json(templates ?? [], {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    })
  } catch (error) {
    console.error('Error fetching templates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const body = await request.json()
    const { name, category, language, body_text, header_type, header_content, footer_text } = body

    if (!name || !body_text) {
      return NextResponse.json({ error: 'name and body_text are required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('message_templates')
      .insert({
        user_id: userId,
        name,
        category: category || 'Marketing',
        language: language || 'en_US',
        body_text,
        header_type: header_type || null,
        header_content: header_content || null,
        footer_text: footer_text || null,
        status: 'Draft',
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error creating template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
<<<<<<< HEAD
=======

async function handleSyncFromMeta() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const supabase = createAdminClient()

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (configError) throw configError

    if (!config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }

    if (!config.waba_id) {
      return NextResponse.json(
        {
          error:
            'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
        },
        { status: 400 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[templates/sync] Token decryption failed:', err)
      return NextResponse.json(
        {
          error:
            'WhatsApp configuration is corrupted — the stored access token cannot be decrypted. ' +
            'This usually means the ENCRYPTION_KEY changed or differs between environments. ' +
            'Go to Settings → WhatsApp Integration, click "Reset Configuration", then re-save your credentials.',
          needs_reset: true,
        },
        { status: 400 },
      )
    }

    const metaTemplates: MetaTemplate[] = []
    let nextUrl:
      | string
      | null = `${META_API_BASE}/${config.waba_id}/message_templates?limit=100&fields=id,name,language,status,category,components`
    const PAGE_CAP = 20
    let pageCount = 0

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++
      const metaRes: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!metaRes.ok) {
        let metaErr = `Meta API error: ${metaRes.status}`
        try {
          const body = await metaRes.json()
          if (body?.error?.message) metaErr = body.error.message
        } catch {
        }
        return NextResponse.json({ error: metaErr }, { status: 502 })
      }

      const metaBody: {
        data?: MetaTemplate[]
        paging?: { next?: string }
      } = await metaRes.json()
      if (metaBody.data) metaTemplates.push(...metaBody.data)
      nextUrl = metaBody.paging?.next ?? null
    }

    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    console.log(`[templates/sync] Starting sync for user ${userId}. Found ${metaTemplates.length} templates from Meta.`)

    for (const t of metaTemplates) {
      const body = (t.components ?? []).find((c) => c.type === 'BODY')
      const header = (t.components ?? []).find((c) => c.type === 'HEADER')
      const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
      const buttonsComp = (t.components ?? []).find((c) => c.type === 'BUTTONS')

      const row = {
        user_id: userId,
        name: t.name,
        category: normalizeCategory(t.category),
        language: t.language,
        header_type: header?.format?.toLowerCase() ?? null,
        header_content: header?.text ?? null,
        body_text: body?.text ?? '',
        footer_text: footer?.text ?? null,
        buttons: buttonsComp?.buttons ?? null,
        status: normalizeStatus(t.status),
        updated_at: new Date(),
      }

      const { data: existing, error: findError } = await supabase
        .from('message_templates')
        .select('id')
        .match({ user_id: userId, name: t.name, language: t.language })
        .maybeSingle()

      if (findError) {
        console.error(`[templates/sync] Find error for ${t.name} (${t.language}):`, findError.message)
        errors.push({
          name: t.name,
          language: t.language,
          message: findError.message,
        })
        continue
      }

      if (existing?.id) {
        const { data: updatedRow, error: updateError } = await supabase
          .from('message_templates')
          .update(row)
          .eq('id', existing.id)
          .select('id, body_text, status')
          .single()

        if (updateError) {
          console.error(`[templates/sync] Update error for ${t.name} (${t.language}):`, updateError.message)
          errors.push({
            name: t.name,
            language: t.language,
            message: updateError.message,
          })
        } else {
          console.log(`[templates/sync] Updated ${t.name} (${t.language}): body_text=${updatedRow?.body_text?.substring(0, 50)}... status=${updatedRow?.status}`)
          updated++
        }
      } else {
        const { error: insertError } = await supabase
          .from('message_templates')
          .insert(row)
          .select()
          .single()

        if (insertError) {
          console.error(`[templates/sync] Insert error for ${t.name} (${t.language}):`, insertError.message)
          errors.push({
            name: t.name,
            language: t.language,
            message: insertError.message,
          })
        } else {
          inserted++
        }
      }
    }

    console.log(`[templates/sync] Sync complete: ${inserted} inserted, ${updated} updated, ${errors.length} errors out of ${metaTemplates.length} total`)

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    })
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
>>>>>>> wacrm/main
