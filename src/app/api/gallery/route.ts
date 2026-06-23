import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const galleryId = searchParams.get("gallery_id");

  const supabase = createAdminClient();

  let query = supabase
    .from("gallery_images")
    .select("*")
    .eq("user_id", session.user.id);

  if (galleryId) {
    query = query.eq("gallery_id", galleryId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ images: data });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const description = formData.get("description") as string | null;
    const galleryId = formData.get("gallery_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const allowedMime = new Set([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/avif",
    ]);

    if (!allowedMime.has(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Use PNG, JPG, WebP, GIF, or AVIF." },
        { status: 400 },
      );
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum 10 MB." },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const timestamp = Date.now();
    const sanitizedName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 100);
    const storagePath = `${session.user.id}/${timestamp}-${sanitizedName}`;

    const supabase = createAdminClient();

    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 },
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("images").getPublicUrl(storagePath);

    const payload: Record<string, unknown> = {
      user_id: session.user.id,
      original_name: file.name,
      storage_path: storagePath,
      public_url: publicUrl,
      description: description ?? null,
      file_size: file.size,
      mime_type: file.type,
    };

    if (galleryId) {
      const { data: gallery } = await supabase
        .from("galleries")
        .select("id")
        .eq("id", galleryId)
        .eq("user_id", session.user.id)
        .single();

      if (gallery) {
        payload.gallery_id = galleryId;
      }
    }

    const { data: imageRecord, error: dbError } = await supabase
      .from("gallery_images")
      .insert(payload)
      .select()
      .single();

    if (dbError) {
      await supabase.storage.from("images").remove([storagePath]);
      return NextResponse.json(
        { error: `Database insert failed: ${dbError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ image: imageRecord });
  } catch (error) {
    console.error("Gallery upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
