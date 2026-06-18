import { createAdminClient } from "@/lib/supabase/admin";

export function adminClient() {
  return createAdminClient();
}
