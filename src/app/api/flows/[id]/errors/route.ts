import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Flow error logs for one flow, newest first.
 *
 * Backed by `flow_error_logs` (migration 025). If the table is missing
 * (migration not applied yet) we return an empty list rather than 500 —
 * the UI then hides the Errors panel quietly.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()

  const { data: flow } = await supabase
    .from('flows')
    .select('id,user_id')
    .eq('id', id)
    .single()

  if (!flow || flow.user_id !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const { data: errors, error } = await supabase
      .from('flow_error_logs')
      .select('*')
      .eq('flow_id', id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    return NextResponse.json({ errors: errors ?? [] })
  } catch (err) {
    // 42P01 = undefined table → migration 025 not applied. Not fatal;
    // report the graceful empty state to the UI.
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('relation "public.flow_error_logs" does not exist')) {
      console.error('[flows/errors] load failed:', message)
    }
    return NextResponse.json({ errors: [] })
  }
}