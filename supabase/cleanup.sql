-- Cleanup any partial user from previous failed attempts
DELETE FROM auth.users WHERE email = 'superadmin@gmail.com';

-- Verify cleanup
SELECT id, email, created_at FROM auth.users WHERE email = 'superadmin@gmail.com';
