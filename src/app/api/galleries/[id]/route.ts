import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const supabase = createAdminClient();

  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("*, gallery_images(count)")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .single();

  if (error || !gallery) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }

  return NextResponse.json({ gallery });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, description } = body;

    const supabase = createAdminClient();

    const { data: existing, error: fetchError } = await supabase
      .from("galleries")
      .select("*")
      .eq("id", id)
      .eq("user_id", session.user.id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }

    const updates: Record<string, string> = {};
    if (name && typeof name === "string") updates.name = name.trim();
    if (description !== undefined)
      updates.description = description?.trim() ?? null;

    const { data: gallery, error: updateError } = await supabase
      .from("galleries")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: `Update failed: ${updateError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ gallery });
  } catch (error) {
    console.error("Update gallery error:", error);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const supabase = createAdminClient();

  const { data: existing, error: fetchError } = await supabase
    .from("galleries")
    .select("*, gallery_images(storage_path)")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }

  const storagePaths = (existing.gallery_images ?? []).map(
    (img: { storage_path: string }) => img.storage_path,
  );

  if (storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("images")
      .remove(storagePaths);

    if (storageError) {
      console.error("Storage bulk delete error:", storageError);
    }
  }

  const { error: imagesError } = await supabase
    .from("gallery_images")
    .delete()
    .eq("gallery_id", id);

  if (imagesError) {
    console.error("Gallery images delete error:", imagesError);
  }

  const { error: dbError } = await supabase
    .from("galleries")
    .delete()
    .eq("id", id);

  if (dbError) {
    return NextResponse.json(
      { error: `Delete failed: ${dbError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
