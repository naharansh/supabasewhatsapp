-- ============================================================
-- CLEANUP: Fix contact_tags integrity
-- Run on Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Preview orphaned rows (references deleted contacts):
SELECT COUNT(*) AS orphaned_count
FROM contact_tags ct
LEFT JOIN contacts c ON c.id = ct.contact_id
WHERE c.id IS NULL;

-- 2. Delete orphaned contact_tags:
DELETE FROM contact_tags ct
WHERE NOT EXISTS (
  SELECT 1 FROM contacts c WHERE c.id = ct.contact_id
);

-- 3. Preview duplicates (same contact_id + tag_id):
SELECT contact_id, tag_id, COUNT(*) AS dupes
FROM contact_tags
GROUP BY contact_id, tag_id
HAVING COUNT(*) > 1;

-- 4. Deduplicate (keep newest row per pair):
DELETE FROM contact_tags ct
USING contact_tags ct2
WHERE ct.contact_id = ct2.contact_id
  AND ct.tag_id = ct2.tag_id
  AND ct.created_at < ct2.created_at;

-- 5. Add UNIQUE constraint (prevents future duplicates):
ALTER TABLE contact_tags
  ADD CONSTRAINT contact_tags_contact_id_tag_id_key
  UNIQUE (contact_id, tag_id);

-- 6. Verify final counts:
SELECT t.name, COUNT(ct.id) AS row_count
FROM tags t
LEFT JOIN contact_tags ct ON ct.tag_id = t.id
GROUP BY t.name
ORDER BY row_count DESC;
