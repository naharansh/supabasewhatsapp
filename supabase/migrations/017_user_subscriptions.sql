-- ============================================================
-- 017_user_subscriptions.sql
--
-- Adds subscription tracking to profiles so each user can be
-- assigned a subscription plan with an expiry date.
--
-- Idempotent -- safe to re-run.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'subscription_id'
  ) THEN
    ALTER TABLE public.profiles
    ADD COLUMN subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'subscription_ends_at'
  ) THEN
    ALTER TABLE public.profiles
    ADD COLUMN subscription_ends_at TIMESTAMPTZ;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_profiles_subscription_id;
CREATE INDEX idx_profiles_subscription_id ON public.profiles(subscription_id);
