import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { toSnakeCase } from '@/lib/utils'

async function requireOwnership(
  flowId: string,
): Promise<
  | {
      ok: true
      userId: string
    }
  | { ok: false; status: number; body: { error: string } }
> {
  const session = await auth()
  if (!session?.user?.id) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  }
  const supabase = createAdminClient()
  const { data: flow } = await supabase
    .from('flows')
    .select('id,user_id')
    .eq('id', flowId)
    .single()

  if (!flow || flow.user_id !== session.user.id) {
    return { ok: false, status: 404, body: { error: 'Not found' } }
  }
  return { ok: true, userId: session.user.id }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const supabase = createAdminClient()

  const [flowResult, nodesResult] = await Promise.all([
    supabase.from('flows').select('*').eq('id', id).single(),
    supabase.from('flow_nodes').select('*').eq('flow_id', id).order('created_at', { ascending: true }),
  ])

  const flow = flowResult.data
  const nodes = nodesResult.data

  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({
    flow: toSnakeCase(flow),
    nodes: toSnakeCase(nodes ?? []),
  })
}

interface PutBody {
  name?: string
  description?: string | null
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
  trigger_config?: Record<string, unknown>
  entry_node_id?: string | null
  fallback_policy?: Record<string, unknown>
  nodes?: Array<{
    node_key: string
    node_type: string
    config: Record<string, unknown>
    position_x?: number
    position_y?: number
  }>
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const supabase = createAdminClient()

  const body = (await request.json().catch(() => null)) as PutBody | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json(
      { error: 'name cannot be empty' },
      { status: 400 },
    )
  }

  const flowPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (body.name !== undefined) flowPatch.name = body.name.trim()
  if (body.description !== undefined)
    flowPatch.description = body.description
  if (body.trigger_type !== undefined) flowPatch.trigger_type = body.trigger_type
  if (body.trigger_config !== undefined)
    flowPatch.trigger_config = body.trigger_config as any
  if (body.entry_node_id !== undefined)
    flowPatch.entry_node_id = body.entry_node_id
  if (body.fallback_policy !== undefined)
    flowPatch.fallback_policy = body.fallback_policy as any

  await supabase
    .from('flows')
    .update(flowPatch)
    .eq('id', id)

  if (body.nodes !== undefined) {
    await supabase
      .from('flow_nodes')
      .delete()
      .eq('flow_id', id)

    if (body.nodes.length > 0) {
      await supabase
        .from('flow_nodes')
        .insert(
          body.nodes.map((n) => ({
            flow_id: id,
            node_key: n.node_key,
            node_type: n.node_type,
            config: n.config as any,
            position_x: n.position_x ?? 0,
            position_y: n.position_y ?? 0,
          })),
        )
        .select()
    }
  }

  const [updatedFlowResult, updatedNodesResult] = await Promise.all([
    supabase.from('flows').select('*').eq('id', id).single(),
    supabase.from('flow_nodes').select('*').eq('flow_id', id).order('created_at', { ascending: true }),
  ])
  return NextResponse.json({ flow: toSnakeCase(updatedFlowResult.data), nodes: toSnakeCase(updatedNodesResult.data ?? []) })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const supabase = createAdminClient()

  await supabase.from('flows').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
