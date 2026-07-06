-- ============================================================
-- STEP 1: DIAGNOSTIC — Run this FIRST to see all actual FK
-- constraints referencing contacts(id) and their ON DELETE actions.
-- ============================================================

SELECT
  c.conrelid::regclass AS table_name,
  a.attname AS column_name,
  c.conname AS constraint_name,
  CASE c.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS on_delete_action
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.confrelid = 'contacts'::regclass
  AND c.contype = 'f'
ORDER BY c.conrelid::regclass::text, a.attname;
