-- ============================================================
-- DIAGNOSTIC: Run this on your LIVE Supabase DB
-- Supabase Dashboard → SQL Editor → paste and run
-- ============================================================

-- 1. How many contacts exist?
SELECT COUNT(*) AS total_contacts FROM contacts;

-- 2. Does contacts have a user_id column?
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'contacts' AND column_name = 'user_id';

-- 3. What user_ids do contacts have?
SELECT user_id, COUNT(*) AS cnt FROM contacts GROUP BY user_id;

-- 4. How many tags?
SELECT COUNT(*) AS total_tags FROM tags;

-- 5. Tags with contact counts via contact_tags
SELECT t.name, t.id AS tag_id, COUNT(ct.contact_id) AS linked_contacts
FROM tags t
LEFT JOIN contact_tags ct ON ct.tag_id = t.id
GROUP BY t.id, t.name;

-- 6. Does contact_tags table exist and have data?
SELECT COUNT(*) AS total_contact_tag_rows FROM contact_tags;

-- 7. Check if contact_tags contact_ids actually exist in contacts
SELECT COUNT(*) AS orphaned_contact_tag_rows
FROM contact_tags ct
LEFT JOIN contacts c ON c.id = ct.contact_id
WHERE c.id IS NULL;
