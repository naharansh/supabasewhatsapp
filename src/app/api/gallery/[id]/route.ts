import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const { data: image, error: fetchError } = await supabase
    .from("gallery_images")
    .select("*")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .single();

  if (fetchError || !image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const { error: storageError } = await supabase.storage
    .from("images")
    .remove([image.storage_path]);

  if (storageError) {
    console.error("Storage delete error:", storageError);
  }

  const { error: dbError } = await supabase
    .from("gallery_images")
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
