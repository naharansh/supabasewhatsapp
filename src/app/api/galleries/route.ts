import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("galleries")
    .select("*, gallery_images(count)")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ galleries: data });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Gallery name is required" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    const { data: gallery, error } = await supabase
      .from("galleries")
      .insert({
        user_id: session.user.id,
        name: name.trim(),
        description: description?.trim() ?? null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Failed to create gallery: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ gallery });
  } catch (error) {
    console.error("Create gallery error:", error);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
