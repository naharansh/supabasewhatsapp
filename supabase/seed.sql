-- ============================================================
-- WA CRM Seed: Superadmin + Demo Data
-- Run this in the Supabase SQL Editor (one statement at a time)
-- ============================================================

-- 1. Fix superadmin password hash (GoTrue needs $2b$10$ format)
UPDATE auth.users
SET encrypted_password = '$2b$10$CtKe/OzPtwEZvN4r60cd6.J0C1XGBkGcqB59Pnu3jy./M8I/NjC4S',
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    raw_user_meta_data = raw_user_meta_data || '{"role":"superadmin","status":"active"}'::jsonb
WHERE email = 'superadmin@gmail.com';

-- 2. Ensure public.users row is active for superadmin
INSERT INTO public.users (id, email, full_name, role, status)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', ''), 'superadmin', 'active'
FROM auth.users WHERE email = 'superadmin@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'superadmin', status = 'active';

-- 3. Ensure profile role is superadmin
UPDATE public.profiles
SET role = 'superadmin'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'superadmin@gmail.com');

-- 4. Create demo user (for testing the approval flow)
DO $$
DECLARE
  _uid UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'demo@gmail.com') THEN
    _uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, confirmation_sent_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      _uid,
      'authenticated', 'authenticated',
      'demo@gmail.com',
      '$2b$10$CtKe/OzPtwEZvN4r60cd6.J0C1XGBkGcqB59Pnu3jy./M8I/NjC4S',
      NOW(), NOW(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Demo User","role":"user","status":"pending"}',
      NOW(), NOW()
    );
    RAISE NOTICE 'Demo user created: demo@gmail.com / 123456 (pending)';
  ELSE
    RAISE NOTICE 'Demo user already exists';
  END IF;
END $$;
