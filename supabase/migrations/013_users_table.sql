-- ============================================================
-- 013_users_table — user management table synced from auth.users
--
-- The app's admin panel manages user roles and status. Supabase
-- Auth stores users in auth.users, but we need a public table
-- for role/status management that the admin API can query and
-- update via the service-role client.
--
-- This migration:
--   1. Creates public.users with role, status, full_name, etc.
--   2. Adds a trigger on auth.users INSERT to auto-populate
--   3. Backfills existing auth.users
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Only service_role can manage users (admin panel uses service-role client)
DROP POLICY IF EXISTS "Service role can manage users" ON public.users;
CREATE POLICY "Service role can manage users" ON public.users
  FOR ALL USING (true) WITH CHECK (true);

-- Authenticated users can read their own row
DROP POLICY IF EXISTS "Users can view own user record" ON public.users;
CREATE POLICY "Users can view own user record" ON public.users
  FOR SELECT USING (auth.uid() = id);

-- Trigger: auto-sync new auth.users into public.users
CREATE OR REPLACE FUNCTION public.sync_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
    COALESCE(NEW.raw_user_meta_data->>'status', 'active')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_user_on_auth_signup ON auth.users;
CREATE TRIGGER sync_user_on_auth_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_new_user();

-- Backfill existing auth.users that don't have a public.users row
INSERT INTO public.users (id, email, full_name, role, status)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', ''),
  COALESCE(au.raw_user_meta_data->>'role', 'user'),
  COALESCE(au.raw_user_meta_data->>'status', 'active')
FROM auth.users au
WHERE NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id)
ON CONFLICT (id) DO NOTHING;
