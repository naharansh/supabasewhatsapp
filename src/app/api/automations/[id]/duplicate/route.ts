import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  const supabase = createAdminClient()

  const { data: original } = await supabase
    .from('automations')
    .select('*')
    .eq('id', id)
    .single()

  if (!original || original.user_id !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: copy } = await supabase
    .from('automations')
    .insert({
      user_id: userId,
      name: `${original.name} (Copy)`,
      description: original.description,
      trigger_type: original.trigger_type,
      trigger_config: original.trigger_config as any,
      is_active: false,
    })
    .select()
    .single()

  const { data: steps } = await supabase
    .from('automation_steps')
    .select('*')
    .eq('automation_id', id)
    .order('position', { ascending: true })

  if (steps && steps.length > 0) {
    const idMap = new Map<string, string>()
    const uid = () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    for (const row of steps) idMap.set(row.id, uid())

    const rows = steps.map((row: typeof steps[number]) => ({
      id: idMap.get(row.id)!,
      automation_id: copy.id,
      parent_step_id: row.parent_step_id ? idMap.get(row.parent_step_id) : null,
      branch: row.branch,
      step_type: row.step_type,
      step_config: row.step_config as any,
      position: row.position,
    }))
    await supabase.from('automation_steps').insert(rows).select()
  }

  return NextResponse.json({ automation: copy }, { status: 201 })
}
