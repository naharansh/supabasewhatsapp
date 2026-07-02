import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFallbackPolicy } from '@/lib/flows/fallback'

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()

  const { data: runs } = await admin
    .from('flow_runs')
    .select('*, flow:flow_id(fallback_policy)')
    .eq('status', 'active')

  if (!runs?.length) return NextResponse.json({ swept: 0 })

  let swept = 0
  for (const r of runs) {
    const policy = resolveFallbackPolicy(r.flow?.fallback_policy ?? null)
    const lastAdvanced = new Date(r.last_advanced_at)
    const ageHours = (now.getTime() - lastAdvanced.getTime()) / (1000 * 60 * 60)
    if (ageHours < policy.on_timeout_hours) continue

    const { data: updated } = await admin
      .from('flow_runs')
      .update({
        status: 'timed_out',
        ended_at: now.toISOString(),
        end_reason: 'stale_sweep',
      })
      .match({ id: r.id, status: 'active' })
      .select()

    if (updated && updated.length > 0) {
      await admin
        .from('flow_run_events')
        .insert({
          flow_run_id: r.id,
          event_type: 'timeout',
          payload: {
            age_hours: Math.round(ageHours * 10) / 10,
            policy_hours: policy.on_timeout_hours,
          },
        })
      swept += 1
    }
  }

  return NextResponse.json({ swept })
}
