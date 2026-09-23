-- ============================================================
-- Flow error logs — persistent, structured error trail for the
-- Flows service.
--
-- Why this table exists: run-scoped failures already land in
-- `flow_run_events.error`, but failures that happen *before* a run
-- row exists (flow insert races, config/contact lookup failures,
-- engine-boundary throws) have nowhere to attach. This table captures
-- every flow-service error — run-scoped or not — with a stable
-- machine-readable `error_code`, so they can be audited in-app without
-- needing the hosting platform's server logs.
--
-- Written only by the service_role runner (`recordFlowError`); users
-- SELECT their own rows (owner-scoped RLS, mirrors `flow_runs`).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS flow_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner of the flow. Always set (required for owner-scoped RLS).
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- SET NULL on flow delete so the audit trail survives flow cleanup.
  flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  -- SET NULL on run/contact/conversation delete — never cascade the trail.
  run_id UUID REFERENCES flow_runs(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  -- Stable machine-readable code, e.g. 'HANDOFF_FAILED', 'ENGINE_THREW'.
  error_code TEXT NOT NULL,
  -- Short human message (trimmed at write time to 500 chars).
  message TEXT NOT NULL,
  -- Longer context: stack, Postgres details, whatsapp message id, etc.
  detail TEXT,
  -- Meta webhook message id, when known — correlates the error to an
  -- inbound delivery.
  meta_message_id TEXT,
  -- The flow node that was being processed, when known.
  node_key TEXT,
  -- Free-form extra context (safe-ish to store; no secrets).
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_error_logs_user_time
  ON flow_error_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_flow_error_logs_run
  ON flow_error_logs(run_id);

CREATE INDEX IF NOT EXISTS idx_flow_error_logs_flow_time
  ON flow_error_logs(flow_id, created_at DESC);

ALTER TABLE flow_error_logs ENABLE ROW LEVEL SECURITY;

-- Owners can read their own error logs. Writes are service_role-only.
DROP POLICY IF EXISTS "Users see own flow error logs" ON flow_error_logs;
CREATE POLICY "Users see own flow error logs" ON flow_error_logs FOR SELECT
  USING (auth.uid() = user_id);