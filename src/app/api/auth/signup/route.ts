import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const { email, password, fullName } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName ?? "",
        status: "pending",
      },
    });

    if (error) {
      if (error.message.includes("already been registered")) {
        return NextResponse.json({ error: "Email already registered" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Ensure a profile row exists (the DB trigger should handle this,
    // but we upsert to be safe since admin.createUser may bypass the trigger)
    const userId = data.user.id;
    await admin.from("profiles").upsert({
      user_id: userId,
      full_name: fullName ?? "",
      email,
      role: "user",
    }, { onConflict: "user_id", ignoreDuplicates: false });

    return NextResponse.json({ id: userId, email, pending: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
