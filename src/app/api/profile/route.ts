import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  const [profileResult, authUserResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);

  if (profileResult.error) throw profileResult.error;

  const profile = profileResult.data;
  const authUser = authUserResult.data?.user;

  if (!profile) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    id: profile.id,
    user_id: profile.user_id,
    full_name: profile.full_name,
    email: profile.email,
    avatar_url: profile.avatar_url,
    role: profile.role,
    created_at: profile.created_at,
    beta_features: profile.beta_features ? (typeof profile.beta_features === 'string' ? JSON.parse(profile.beta_features) : profile.beta_features) : [],
    two_factor_enabled: (authUser?.user_metadata?.two_factor_enabled as boolean) ?? false,
  });
}
