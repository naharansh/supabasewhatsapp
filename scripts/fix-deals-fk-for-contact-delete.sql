-- ============================================================
-- Fix: deals.conversation_id FK blocks contact deletion
--
-- Error: 23503: update or delete on table "contacts" violates
--   foreign key constraint on table "deals"
--
-- Root cause: Deleting a contact CASCADE-deletes its conversations,
-- but deals.conversation_id REFERENCES conversations(id) with
-- NO ACTION (default), which blocks the cascade.
--
-- Fix: Change to ON DELETE SET NULL (deal survives, conversation
-- link is nulled — the UI already handles NULL conversation_id).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_conversation_id_fkey'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      DROP CONSTRAINT deals_conversation_id_fkey;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    ON DELETE SET NULL;

-- Also fix deals.stage_id: when a pipeline is deleted, its stages
-- CASCADE-delete, but deals referencing those stages would block.
-- Change to ON DELETE SET NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_stage_id_fkey'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      DROP CONSTRAINT deals_stage_id_fkey;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_stage_id_fkey
    FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id)
    ON DELETE SET NULL;
