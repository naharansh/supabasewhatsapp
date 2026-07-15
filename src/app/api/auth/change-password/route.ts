import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const { email, currentPassword, newPassword } = await request.json();

    if (!email || !currentPassword || !newPassword) {
      return NextResponse.json({ error: "Email, current password, and new password are required" }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify({ email, password: currentPassword }),
    });

    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || verifyData.error) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    let userId = verifyData.user?.sub;
    if (!userId && verifyData.access_token) {
      try {
        const payload = JSON.parse(Buffer.from(verifyData.access_token.split(".")[1], "base64").toString());
        userId = payload.sub;
      } catch {}
    }
    if (!userId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const admin = createAdminClient();
    const { error: updateError } = await admin.auth.admin.updateUserById(
      userId,
      { password: newPassword },
    );

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
