-- ============================================================
-- STEP 2: ROBUST FIX — Finds and fixes ALL FK constraints
-- referencing contacts(id) that use NO ACTION or RESTRICT.
-- Does NOT rely on constraint names — uses catalog queries.
--
-- Run STEP 1 first to see the diagnostics.
-- ============================================================

-- Fix direct FKs: deals.contact_id and broadcast_recipients.contact_id
-- and any other table with contact_id referencing contacts(id) using NO ACTION/RESTRICT
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      c.conrelid::regclass::text AS tbl,
      a.attname AS col,
      c.conname AS con
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.confrelid = 'contacts'::regclass
      AND c.contype = 'f'
      AND c.confdeltype IN ('a', 'r')  -- NO ACTION or RESTRICT
  LOOP
    RAISE NOTICE 'Fixing %.% (constraint: %)', r.tbl, r.col, r.con;

    -- Drop NOT NULL if present
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', r.tbl, r.col);

    -- Drop the constraint
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.con);

    -- Re-add with ON DELETE SET NULL
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES contacts(id) ON DELETE SET NULL',
      r.tbl, r.con, r.col
    );
  END LOOP;
END $$;

-- Fix indirect FKs: deals.conversation_id referencing conversations(id) with NO ACTION
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      c.conrelid::regclass::text AS tbl,
      a.attname AS col,
      c.conname AS con
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.confrelid = 'conversations'::regclass
      AND c.contype = 'f'
      AND c.confdeltype IN ('a', 'r')  -- NO ACTION or RESTRICT
  LOOP
    RAISE NOTICE 'Fixing %.% (constraint: %)', r.tbl, r.col, r.con;

    -- Drop NOT NULL if present
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', r.tbl, r.col);

    -- Drop the constraint
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.con);

    -- Re-add with ON DELETE SET NULL
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE SET NULL',
      r.tbl, r.con, r.col, c.confrelid::regclass::text
    );
  END LOOP;
END $$;

-- Fix indirect FKs: deals.stage_id referencing pipeline_stages(id) with NO ACTION
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      c.conrelid::regclass::text AS tbl,
      a.attname AS col,
      c.conname AS con,
      c.confrelid::regclass::text AS ref_tbl
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.confrelid = 'pipeline_stages'::regclass
      AND c.contype = 'f'
      AND c.confdeltype IN ('a', 'r')
  LOOP
    RAISE NOTICE 'Fixing %.% (constraint: %)', r.tbl, r.col, r.con;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', r.tbl, r.col);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.con);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE SET NULL',
      r.tbl, r.con, r.col, r.ref_tbl
    );
  END LOOP;
END $$;
