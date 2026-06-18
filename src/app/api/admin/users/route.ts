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

  const { data: users, error: usersError } = await admin
    .from('users')
    .select('id, email, full_name, role, status')
    .order('email', { ascending: true });

  if (usersError) throw usersError;

  const mapped = (users ?? []).map(u => ({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    status: u.status,
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
    const { userId, status } = await request.json();

    if (!userId || !["active", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { data: target, error: targetError } = await admin
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (targetError || !target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (target.role === "superadmin") {
      return NextResponse.json({ error: "Cannot change superadmin status" }, { status: 403 });
    }

    const { error: updateError } = await admin
      .from('users')
      .update({ status })
      .eq('id', userId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, status });
  } catch {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
