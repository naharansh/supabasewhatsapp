import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";

const PROJECT_REF = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];

function formatUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  return {
    user: {
      id: user.id,
      email: user.email ?? "",
      name: (user.user_metadata?.full_name as string) ?? user.email ?? "",
      image: (user.user_metadata?.avatar_url as string) ?? null,
    },
  };
}

/**
 * Get the current authenticated user session on the server.
 * Compatible with the old NextAuth `auth()` return shape.
 *
 * Uses two strategies:
 *  1. Standard @supabase/ssr createServerClient (primary)
 *  2. Direct cookie read + admin client JWT verify (fallback for
 *     @supabase/ssr v0.10.3 decodeChunkedCookieValue bug on production)
 */
export async function auth() {
  // Strategy 1: standard @supabase/ssr server client
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (user && !error) return formatUser(user);

  // Strategy 2: fallback for @supabase/ssr v0.10.3 cookie-decoding bug on
  // production. Read the auth cookie directly, extract the JWT, and verify
  // it via the admin client (service_role key, no cookie dependency).
  try {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get(`sb-${PROJECT_REF}-auth-token`);

    if (authCookie?.value) {
      let accessToken: string;
      try {
        const parsed = JSON.parse(authCookie.value);
        accessToken = Array.isArray(parsed) ? parsed[0] : parsed.access_token;
      } catch {
        accessToken = authCookie.value;
      }

      if (accessToken) {
        const admin = createAdminClient();
        const {
          data: { user: u },
          error: e,
        } = await admin.auth.getUser(accessToken);
        if (u && !e) return formatUser(u);
      }
    }
  } catch {
    // Silently continue — both strategies failed
  }

  return null;
}

/**
 * Sign in via email magic link (or OTP).
 */
export async function signIn(_email: string, _options?: { redirectTo?: string }) {
  throw new Error("Not implemented — use signInWithPassword instead");
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  const supabase = await createClient();
  return supabase.auth.signOut();
}

/**
 * Sign up a new user.
 */
export async function signUp(email: string, password: string, metadata?: Record<string, unknown>) {
  const supabase = await createClient();
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });
}

/**
 * Update the authenticated user's password.
 */
export async function updatePassword(password: string) {
  const supabase = await createClient();
  return supabase.auth.updateUser({ password });
}

/**
 * Admin-level user lookup (uses service_role key).
 */
export async function adminGetUser(userId: string) {
  const admin = createAdminClient();
  return admin.auth.admin.getUserById(userId);
}
