import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@/lib/supabase/server'
import { validateFlowForActivation } from '@/lib/flows/validate'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const supabase = await createClient()

  const body = (await request.json().catch(() => null)) as
    | { status?: 'draft' | 'active' | 'archived' }
    | null
  const status = body?.status
  if (!status || !['draft', 'active', 'archived'].includes(status)) {
    return NextResponse.json(
      { error: "status must be one of 'draft' | 'active' | 'archived'" },
      { status: 400 },
    )
  }

  const { data: existing } = await supabase
    .from('flows')
    .select('id,user_id')
    .eq('id', id)
    .single()

  if (!existing || existing.user_id !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (status === 'active') {
    const [flowResult, nodesResult] = await Promise.all([
      supabase
        .from('flows')
        .select('name,trigger_type,trigger_config,entry_node_id')
        .eq('id', id)
        .single(),
      supabase
        .from('flow_nodes')
        .select('node_key,node_type,config')
        .eq('flow_id', id),
    ])

    const flow = flowResult.data
    const nodes = nodesResult.data

    if (!flow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const issues = validateFlowForActivation(
      {
        name: flow.name,
        trigger_type: flow.trigger_type as 'keyword' | 'first_inbound_message' | 'manual',
        trigger_config: flow.trigger_config as any,
        entry_node_id: flow.entry_node_id,
      },
      (nodes ?? []).map((n: any) => ({
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config as any,
      })),
    )
    const blockers = issues.filter((i) => i.severity === 'error')
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot activate flow — fix the issues below first.',
          issues,
        },
        { status: 422 },
      )
    }
  }

  const { data: updated } = await supabase
    .from('flows')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  return NextResponse.json({ flow: updated })
}
