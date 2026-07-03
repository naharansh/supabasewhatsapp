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
    admin.from('profiles').select('subscription_id, subscription_ends_at, subscriptions(id, name, description, price, duration_days, features, contact_limit, message_limit, is_active)').eq('user_id', userId).maybeSingle(),
  ]);

  if (profileResult.error) throw profileResult.error;

  const profile = profileResult.data;
  const authUser = authUserResult.data?.user;
  const subscriptionData = subscriptionResult.data;

  if (!profile) {
    return NextResponse.json(null);
  }

  const { data: convIds } = await admin
    .from('conversations')
    .select('id')
    .eq('user_id', userId);

  const ids = convIds?.map(c => c.id) ?? [];

  const { count: contactCount } = await admin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const agentQueryOrFallback = ids.length > 0
    ? admin.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_type', 'agent')
        .in('conversation_id', ids)
    : Promise.resolve({ count: 0, error: null });

  const { data: userBroadcasts } = await admin
    .from('broadcasts')
    .select('id')
    .eq('user_id', userId);

  const broadcastIds = userBroadcasts?.map(b => b.id) ?? [];
  const broadcastQueryOrFallback = broadcastIds.length > 0
    ? admin.from('broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .in('broadcast_id', broadcastIds)
        .in('status', ['sent', 'delivered', 'read'])
    : Promise.resolve({ count: 0, error: null });

  const [agentResult, broadcastResult] = await Promise.all([agentQueryOrFallback, broadcastQueryOrFallback]);
  const messageCount = (agentResult.count ?? 0) + (broadcastResult.count ?? 0);

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
    contact_limit: profile.contact_limit ?? 0,
    contact_count: contactCount ?? 0,
    message_limit: profile.message_limit ?? 0,
    message_count: messageCount,
    subscription: subscriptionData?.subscriptions ?? null,
  });
}
