-- ============================================================
-- 015_galleries.sql
--
-- Adds the `galleries` table so each user can create multiple
-- named collections of images, and links `gallery_images` to a
-- gallery via `gallery_id`.
--
-- Idempotent -- safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.galleries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.galleries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Galleries are readable by authenticated users" ON public.galleries;
CREATE POLICY "Galleries are readable by authenticated users"
  ON public.galleries FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can insert their own galleries" ON public.galleries;
CREATE POLICY "Users can insert their own galleries"
  ON public.galleries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own galleries" ON public.galleries;
CREATE POLICY "Users can update their own galleries"
  ON public.galleries FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own galleries" ON public.galleries;
CREATE POLICY "Users can delete their own galleries"
  ON public.galleries FOR DELETE
  USING (auth.uid() = user_id);

DROP INDEX IF EXISTS idx_galleries_user_id;
CREATE INDEX idx_galleries_user_id ON public.galleries(user_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'gallery_images'
      AND column_name = 'gallery_id'
  ) THEN
    ALTER TABLE public.gallery_images
    ADD COLUMN gallery_id UUID REFERENCES public.galleries(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_gallery_images_gallery_id;
CREATE INDEX idx_gallery_images_gallery_id ON public.gallery_images(gallery_id);

CREATE OR REPLACE FUNCTION public.update_galleries_updated_at()
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

DROP TRIGGER IF EXISTS trg_galleries_updated_at ON public.galleries;
CREATE TRIGGER trg_galleries_updated_at
  BEFORE UPDATE ON public.galleries
  FOR EACH ROW EXECUTE FUNCTION public.update_galleries_updated_at();
