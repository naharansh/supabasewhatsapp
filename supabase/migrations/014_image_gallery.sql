-- ============================================================
-- 014_image_gallery.sql
--
-- Creates the `images` Storage bucket for user-uploaded gallery
-- images and a `gallery_images` table to track metadata.
--
-- Each user can upload, view, and delete their own images.
-- Authenticated users can generate shareable links to any
-- public image in the bucket.
--
-- Idempotent -- safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'images',
  'images',
  TRUE,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Images are publicly readable" ON storage.objects;
CREATE POLICY "Images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'images');

DROP POLICY IF EXISTS "Users can upload their own images" ON storage.objects;
CREATE POLICY "Users can upload their own images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update their own images" ON storage.objects;
CREATE POLICY "Users can update their own images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete their own images" ON storage.objects;
CREATE POLICY "Users can delete their own images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE TABLE IF NOT EXISTS public.gallery_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  description TEXT,
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gallery_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gallery images are readable by authenticated users" ON public.gallery_images;
CREATE POLICY "Gallery images are readable by authenticated users"
  ON public.gallery_images FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can insert their own gallery images" ON public.gallery_images;
CREATE POLICY "Users can insert their own gallery images"
  ON public.gallery_images FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own gallery images" ON public.gallery_images;
CREATE POLICY "Users can update their own gallery images"
  ON public.gallery_images FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own gallery images" ON public.gallery_images;
CREATE POLICY "Users can delete their own gallery images"
  ON public.gallery_images FOR DELETE
  USING (auth.uid() = user_id);

DROP INDEX IF EXISTS idx_gallery_images_user_id;
CREATE INDEX idx_gallery_images_user_id ON public.gallery_images(user_id);

DROP INDEX IF EXISTS idx_gallery_images_created_at;
CREATE INDEX idx_gallery_images_created_at ON public.gallery_images(created_at DESC);

CREATE OR REPLACE FUNCTION public.update_gallery_images_updated_at()
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

DROP TRIGGER IF EXISTS trg_gallery_images_updated_at ON public.gallery_images;
CREATE TRIGGER trg_gallery_images_updated_at
  BEFORE UPDATE ON public.gallery_images
  FOR EACH ROW EXECUTE FUNCTION public.update_gallery_images_updated_at();
