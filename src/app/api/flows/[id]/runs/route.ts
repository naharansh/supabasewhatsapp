import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = await createClient()

  const { data: flow } = await supabase
    .from('flows')
    .select('id,name,user_id')
    .eq('id', id)
    .single()

  if (!flow || flow.user_id !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: runs } = await supabase
    .from('flow_runs')
    .select('*, contact:contact_id(id,name,phone)')
    .eq('flow_id', id)
    .order('started_at', { ascending: false })
    .limit(50)

  const runIds = (runs ?? []).map((r: any) => r.id)
  let events: Array<{
    flowRunId: string
    eventType: string
    nodeKey: string | null
    payload: Record<string, unknown>
    createdAt: Date
  }> = []
  if (runIds.length > 0) {
    try {
      const { data: evs } = await supabase
        .from('flow_run_events')
        .select('flow_run_id,event_type,node_key,payload,created_at')
        .in('flow_run_id', runIds)
        .order('created_at', { ascending: true })

      events = (evs ?? []).map((e: any) => ({
        flowRunId: e.flow_run_id,
        eventType: e.event_type,
        nodeKey: e.node_key,
        payload: e.payload as Record<string, unknown>,
        createdAt: e.created_at,
      }))
    } catch (evsErr) {
      console.error('[flows-runs] events fetch failed:', evsErr instanceof Error ? evsErr.message : evsErr)
    }
  }

  return NextResponse.json({
    flow: { id: flow.id, name: flow.name },
    runs: runs ?? [],
    events,
  })
}
