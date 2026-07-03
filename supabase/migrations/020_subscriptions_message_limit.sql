-- ============================================================
-- 020_subscriptions_message_limit.sql
--
-- Adds message_limit column to the subscriptions table.
-- 0 means unlimited (no message cap).
--
-- Idempotent -- safe to re-run.
-- ============================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS message_limit INTEGER NOT NULL DEFAULT 0;
