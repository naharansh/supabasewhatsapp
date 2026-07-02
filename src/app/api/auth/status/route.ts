import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("status")
    .eq("id", session.user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ status: "active" });
  }

  return NextResponse.json({ status: data.status });
}
