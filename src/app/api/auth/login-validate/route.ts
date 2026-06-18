import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // Check if 2FA is enabled via user_metadata
    const twoFactorEnabled = data.user?.user_metadata?.two_factor_enabled !== false;

    if (twoFactorEnabled) {
      // Send OTP for 2FA
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });

      if (otpError) {
        // OTP send failed, but password was valid — sign out and return error
        await supabase.auth.signOut();
        return NextResponse.json({ error: "Failed to send verification code" }, { status: 500 });
      }

      return NextResponse.json({
        step: "2fa",
        email,
      });
    }

    // 2FA not required — session is already set by signInWithPassword
    return NextResponse.json({ step: "signin" });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
