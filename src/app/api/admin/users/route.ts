import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: currentUser, error: currentError } = await admin
    .from('users')
    .select('role')
    .eq('id', session.user.id)
    .single();

  if (currentError) throw currentError;

  if (!currentUser || currentUser.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [usersResult, subscriptionsResult] = await Promise.all([
    admin.from('users').select('id, email, full_name, role, status').order('email', { ascending: true }),
    admin.from('profiles').select('user_id, subscription_id, subscription_ends_at').not('subscription_id', 'is', null),
  ]);

  if (usersResult.error) throw usersResult.error;
  if (subscriptionsResult.error) throw subscriptionsResult.error;

  const subMap = new Map(subscriptionsResult.data.map(p => [p.user_id, { subscription_id: p.subscription_id, subscription_ends_at: p.subscription_ends_at }]));

  const mapped = (usersResult.data ?? []).map(u => ({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    status: u.status,
    ...(subMap.get(u.id) || { subscription_id: null, subscription_ends_at: null }),
  }));

  return NextResponse.json({ users: mapped });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: currentUser, error: currentError } = await admin
    .from('users')
    .select('role')
    .eq('id', session.user.id)
    .single();

  if (currentError) throw currentError;

  if (!currentUser || currentUser.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { userId, status, subscription_id, subscription_ends_at } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const { data: target, error: targetError } = await admin
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (targetError || !target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (target.role === "superadmin" && status) {
      return NextResponse.json({ error: "Cannot change superadmin status" }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;

    if (updates.status || Object.keys(updates).length > 0) {
      const { error: updateError } = await admin
        .from('users')
        .update(updates)
        .eq('id', userId);

      if (updateError) throw updateError;
    }

    if (subscription_id !== undefined) {
      const profileUpdates: Record<string, unknown> = { subscription_id: subscription_id || null };
      if (subscription_ends_at) {
        profileUpdates.subscription_ends_at = subscription_ends_at;
      } else if (subscription_id) {
        profileUpdates.subscription_ends_at = null;
      }
      const { error: profileError } = await admin
        .from('profiles')
        .update(profileUpdates)
        .eq('user_id', userId);

      if (profileError) throw profileError;
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
