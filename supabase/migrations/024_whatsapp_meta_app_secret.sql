-- Add per-user meta_app_secret column to whatsapp_config.
-- Each user on a different Meta App needs their own App Secret for
-- webhook HMAC signature verification. Encrypted with the same
-- ENCRYPTION_KEY used for access_token/verify_token.

ALTER TABLE whatsapp_config
ADD COLUMN IF NOT EXISTS meta_app_secret text;

COMMENT ON COLUMN whatsapp_config.meta_app_secret IS
  'Encrypted Meta App Secret for per-user webhook HMAC verification. NULL = fall back to global META_APP_SECRET env var.';
