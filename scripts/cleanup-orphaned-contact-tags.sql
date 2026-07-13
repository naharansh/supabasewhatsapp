-- ============================================================
-- CLEANUP: Remove orphaned contact_tags
-- Run on LIVE Supabase DB → SQL Editor
-- These are tag links pointing to contacts that no longer exist.
-- ============================================================

-- Preview first (safe, no changes):
SELECT ct.id, ct.contact_id, ct.tag_id
FROM contact_tags ct
LEFT JOIN contacts c ON c.id = ct.contact_id
WHERE c.id IS NULL
LIMIT 20;

-- Delete all orphaned contact_tags:
DELETE FROM contact_tags ct
WHERE NOT EXISTS (
  SELECT 1 FROM contacts c WHERE c.id = ct.contact_id
);

-- Verify cleanup:
SELECT COUNT(*) AS remaining_orphaned
FROM contact_tags ct
LEFT JOIN contacts c ON c.id = ct.contact_id
WHERE c.id IS NULL;
