import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFlowTemplate } from '@/lib/flows/templates'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) {
    return null
  }
  return session.user.id
}

export async function GET() {
  const userId = await requireUser()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('flows')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ flows: data ?? [] })
}

export async function POST(request: Request) {
  const userId = await requireUser()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string
        description?: string | null
        trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
        trigger_config?: Record<string, unknown>
        template_slug?: string
      }
    | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.template_slug) {
    const template = getFlowTemplate(body.template_slug)
    if (!template) {
      return NextResponse.json(
        { error: `Unknown template_slug "${body.template_slug}"` },
        { status: 400 },
      )
    }
    const { data: flow, error } = await supabase
      .from('flows')
      .insert({
        user_id: userId,
        name: body.name?.trim() || template.name,
        description: template.description,
        status: 'draft',
        trigger_type: template.trigger_type,
        trigger_config: template.trigger_config as any,
        entry_node_id: template.entry_node_id,
      })
      .select()
      .single()

    if (error || !flow) {
      return NextResponse.json(
        { error: error?.message ?? 'insert failed' },
        { status: 500 },
      )
    }

    if (template.nodes.length > 0) {
      const { error: nodesErr } = await supabase
        .from('flow_nodes')
        .insert(
          template.nodes.map((n: any) => ({
            flow_id: flow.id,
            node_key: n.node_key as string,
            node_type: n.node_type as string,
            config: n.config as any,
          })),
        )
        .select()

      if (nodesErr) {
        await supabase.from('flows').delete().eq('id', flow.id)
        return NextResponse.json(
          { error: nodesErr.message },
          { status: 500 },
        )
      }
    }
    return NextResponse.json({ flow }, { status: 201 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const trigger_type = body.trigger_type ?? 'keyword'

  const { data, error } = await supabase
    .from('flows')
    .insert({
      user_id: userId,
      name: body.name.trim(),
      description: body.description ?? null,
      status: 'draft',
      trigger_type: trigger_type,
      trigger_config: (body.trigger_config ?? {}) as any,
    })
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'insert failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ flow: data }, { status: 201 })
}
