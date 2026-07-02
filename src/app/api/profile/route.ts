import { NextResponse } from "next/server";
import { auth } from "@/auth";
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

  const admin = createAdminClient();

  const [profileResult, authUserResult, subscriptionResult] = await Promise.all([
    admin.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
    admin.from('profiles').select('subscription_id, subscription_ends_at, subscriptions(id, name, description, price, duration_days, features, is_active)').eq('user_id', userId).maybeSingle(),
  ]);

  if (profileResult.error) throw profileResult.error;

  const profile = profileResult.data;
  const authUser = authUserResult.data?.user;
  const subscriptionData = subscriptionResult.data;

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
    subscription_id: profile.subscription_id ?? null,
    subscription_ends_at: profile.subscription_ends_at ?? null,
    subscription: subscriptionData?.subscriptions ?? null,
  });
}
