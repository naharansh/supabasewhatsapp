-- ============================================================
-- 016_subscriptions.sql
--
-- Adds the `subscriptions` table for superadmin to manage
-- subscription plans that can be assigned to users.
--
-- Idempotent -- safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 30,
  features JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Subscriptions are readable by authenticated users" ON public.subscriptions;
CREATE POLICY "Subscriptions are readable by authenticated users"
  ON public.subscriptions FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Only superadmins can insert subscriptions" ON public.subscriptions;
CREATE POLICY "Only superadmins can insert subscriptions"
  ON public.subscriptions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'superadmin')
  );

DROP POLICY IF EXISTS "Only superadmins can update subscriptions" ON public.subscriptions;
CREATE POLICY "Only superadmins can update subscriptions"
  ON public.subscriptions FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'superadmin')
  );

DROP POLICY IF EXISTS "Only superadmins can delete subscriptions" ON public.subscriptions;
CREATE POLICY "Only superadmins can delete subscriptions"
  ON public.subscriptions FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'superadmin')
  );

CREATE OR REPLACE FUNCTION public.update_subscriptions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_subscriptions_updated_at();
