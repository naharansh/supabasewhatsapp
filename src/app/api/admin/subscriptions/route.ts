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

  const { data: subscriptions, error } = await admin
    .from('subscriptions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return NextResponse.json({ subscriptions: subscriptions ?? [] });
}

export async function POST(request: Request) {
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
    const { name, description, price, duration_days, features, is_active } = await request.json();

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const { data, error } = await admin
      .from('subscriptions')
      .insert({
        name: name.trim(),
        description: description ?? null,
        price: price ?? 0,
        duration_days: duration_days ?? 30,
        features: features ?? [],
        is_active: is_active ?? true,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ subscription: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
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
    const { id, name, description, price, duration_days, features, is_active } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Subscription ID is required" }, { status: 400 });
    }

    const { data, error } = await admin
      .from('subscriptions')
      .update({
        name: name?.trim(),
        description,
        price,
        duration_days,
        features,
        is_active,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ subscription: data });
  } catch {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Subscription ID is required" }, { status: 400 });
    }

    const { error } = await admin
      .from('subscriptions')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
