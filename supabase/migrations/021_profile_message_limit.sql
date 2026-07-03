-- ============================================================
-- 021_profile_message_limit.sql
--
-- Adds a cumulative message_limit column to the profiles table.
-- Each subscription purchase adds its plan's message_limit
-- to this running total.
--
-- Idempotent -- safe to re-run.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS message_limit INTEGER NOT NULL DEFAULT 0;
