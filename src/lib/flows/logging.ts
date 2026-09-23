import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Structured error logging for the conversational Flows service.
 *
 * Every flow-service failure should flow through `recordFlowError` so
 * that (a) run-scoped failures land in `flow_run_events` with a stable
 * `code`, (b) every failure — including pre-run ones that have no run
 * to attach to — is persisted to `flow_error_logs` when that table is
 * present, and (c) the same payload is mirrored to `console.error`
 * under a greppable `[flows]` prefix for platform log inspection.
 *
 * Logging is strictly best-effort: it never throws into the caller, so
 * the error it is reporting is never masked by a logging failure.
 */

export interface FlowErrorContext {
  /** Owner of the flow — always required so RLS can see the row later. */
  userId: string
  /** Stable machine-readable code, e.g. `HANDOFF_FAILED`. */
  code: string
  /** Short human message, e.g. "conversations.update failed". */
  message: string
  /** Longer context — DB error.details, stack, whatsapp message id… */
  detail?: string
  flowId?: string
  /** Null when the failure happened before a run row existed. */
  runId?: string | null
  nodeKey?: string | null
  contactId?: string | null
  conversationId?: string | null
  metaMessageId?: string | null
  /** Extra free-form context to serialise into the log row. */
  extra?: Record<string, unknown>
}

/** Normalise an unknown thrown value into something serialisable. */
export function normalizeError(err: unknown): { message: string; detail?: string } {
  if (err instanceof Error) {
    return { message: err.message, detail: err.stack }
  }
  if (typeof err === 'string') return { message: err }
  try {
    return { message: JSON.stringify(err) }
  } catch {
    return { message: String(err) }
  }
}

export async function recordFlowError(
  ctx: FlowErrorContext,
): Promise<void> {
  const admin = createAdminClient()
  const detail = ctx.detail ?? ''

  // 1. Run-scoped failure → append to the run's event stream so it shows
  //    up in the runs page / inline Logs panel immediately.
  if (ctx.runId) {
    try {
      await admin.from('flow_run_events').insert({
        flow_run_id: ctx.runId,
        event_type: 'error',
        node_key: ctx.nodeKey ?? null,
        payload: {
          code: ctx.code,
          message: ctx.message,
          detail,
          ...(ctx.metaMessageId ? { meta_message_id: ctx.metaMessageId } : {}),
        } as Record<string, unknown>,
      })
    } catch (err) {
      console.error(
        '[flows] recordFlowError: failed to write flow_run_events',
        err instanceof Error ? err.message : err,
      )
    }
  }

  // 2. Persistent error log. Feature-detected: projects that haven't run
  //    migration 025 yet simply skip the insert (failures are still in
  //    the run events + console).
  try {
    await admin.from('flow_error_logs').insert({
      user_id: ctx.userId,
      flow_id: ctx.flowId ?? null,
      run_id: ctx.runId ?? null,
      contact_id: ctx.contactId ?? null,
      conversation_id: ctx.conversationId ?? null,
      node_key: ctx.nodeKey ?? null,
      error_code: ctx.code,
      message: ctx.message.slice(0, 500),
      detail: detail.slice(0, 4000),
      meta_message_id: ctx.metaMessageId ?? null,
      extra: ctx.extra ?? null,
    } as Record<string, unknown>)
  } catch (err) {
    // 42P01 = undefined_table → migration 025 not applied. Anything else is
    // an RLS/permission problem. Either way: log, never throw.
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('relation "public.flow_error_logs" does not exist')) {
      console.error(
        '[flows] recordFlowError: failed to write flow_error_logs',
        message,
      )
    }
  }

  // 3. Console mirror — greppable server/platform logs.
  console.error('[flows]', {
    code: ctx.code,
    message: ctx.message,
    detail,
    flowId: ctx.flowId ?? null,
    runId: ctx.runId ?? null,
    nodeKey: ctx.nodeKey ?? null,
    userId: ctx.userId,
    contactId: ctx.contactId ?? null,
    conversationId: ctx.conversationId ?? null,
    metaMessageId: ctx.metaMessageId ?? null,
    ...ctx.extra,
  })
}