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
    .select('id, name, price, duration_days, contact_limit, message_limit, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) throw error;

  return NextResponse.json({ subscriptions: subscriptions ?? [] });
}


