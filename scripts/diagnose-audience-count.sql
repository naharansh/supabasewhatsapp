-- ============================================================
-- DIAGNOSTIC: Check broadcast audience data
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Check total contacts per user
SELECT
  u.id AS user_id,
  u.email,
  COUNT(c.id) AS contact_count
FROM auth.users u
LEFT JOIN contacts c ON c.user_id = u.id
GROUP BY u.id, u.email
ORDER BY contact_count DESC;

-- 2. Check all tags per user
SELECT
  t.id AS tag_id,
  t.name AS tag_name,
  t.color,
  t.user_id,
  COUNT(ct.id) AS tagged_contacts
FROM tags t
LEFT JOIN contact_tags ct ON ct.tag_id = t.id
GROUP BY t.id, t.name, t.color, t.user_id
ORDER BY tagged_contacts DESC;

-- 3. Check contact_tags entries (are there any?)
SELECT COUNT(*) AS total_contact_tag_entries FROM contact_tags;

-- 4. Check contact_tags that reference contacts belonging to user
-- (This is what the audience query should resolve to)
SELECT
  u.id AS user_id,
  u.email,
  t.name AS tag_name,
  COUNT(DISTINCT ct.contact_id) AS contacts_with_tag
FROM auth.users u
JOIN contacts c ON c.user_id = u.id
JOIN contact_tags ct ON ct.contact_id = c.id
JOIN tags t ON t.id = ct.tag_id
GROUP BY u.id, u.email, t.name
ORDER BY contacts_with_tag DESC;

-- 5. Check for orphaned contact_tags (contact_id references non-existent contact)
SELECT COUNT(*) AS orphaned_entries
FROM contact_tags ct
LEFT JOIN contacts c ON c.id = ct.contact_id
WHERE c.id IS NULL;

-- 6. Check for orphaned contact_tags (tag_id references non-existent tag)
SELECT COUNT(*) AS orphaned_tag_refs
FROM contact_tags ct
LEFT JOIN tags t ON t.id = ct.tag_id
WHERE t.id IS NULL;

-- 7. Check if contact_tags table exists and has correct structure
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'contact_tags'
ORDER BY ordinal_position;

-- 8. Check custom_fields per user
SELECT
  cf.id,
  cf.field_name,
  cf.user_id,
  COUNT(ccv.id) AS value_count
FROM custom_fields cf
LEFT JOIN contact_custom_values ccv ON ccv.custom_field_id = cf.id
GROUP BY cf.id, cf.field_name, cf.user_id;

-- 9. Quick sanity check: how many contacts have phone numbers?
SELECT
  COUNT(*) AS total_contacts,
  COUNT(phone) AS contacts_with_phone,
  COUNT(*) - COUNT(phone) AS contacts_without_phone
FROM contacts;

-- 10. Check RLS is enabled on critical tables
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename IN ('contacts', 'tags', 'contact_tags', 'contact_custom_values')
  AND schemaname = 'public';
