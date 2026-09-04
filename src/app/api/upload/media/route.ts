import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const MIME_TYPES: Record<
  string,
  { contentType: "image" | "video" | "audio" | "document"; maxSize: number }
> = {
  "image/jpeg": { contentType: "image", maxSize: 5 * 1024 * 1024 },
  "image/png": { contentType: "image", maxSize: 5 * 1024 * 1024 },
  "video/mp4": { contentType: "video", maxSize: 16 * 1024 * 1024 },
  "video/3gpp": { contentType: "video", maxSize: 16 * 1024 * 1024 },
  "audio/mpeg": { contentType: "audio", maxSize: 16 * 1024 * 1024 },
  "audio/ogg": { contentType: "audio", maxSize: 16 * 1024 * 1024 },
  "audio/amr": { contentType: "audio", maxSize: 16 * 1024 * 1024 },
  "application/pdf": { contentType: "document", maxSize: 100 * 1024 * 1024 },
  "application/msword": { contentType: "document", maxSize: 100 * 1024 * 1024 },
  "application/vnd.ms-powerpoint": {
    contentType: "document",
    maxSize: 100 * 1024 * 1024,
  },
  "application/vnd.ms-excel": { contentType: "document", maxSize: 100 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    { contentType: "document", maxSize: 100 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    { contentType: "document", maxSize: 100 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    { contentType: "document", maxSize: 100 * 1024 * 1024 },
  "text/plain": { contentType: "document", maxSize: 100 * 1024 * 1024 },
};

const BUCKET = "message-media";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const spec = MIME_TYPES[file.type];
    if (!spec) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Use images (JPG/PNG), videos (MP4/3GP), audio (MP3/OGG/AMR), or documents (PDF/DOC/XLS/PPT/TXT).",
        },
        { status: 400 },
      );
    }

    if (file.size > spec.maxSize) {
      return NextResponse.json(
        {
          error: `File too large. Maximum ${Math.round(
            spec.maxSize / (1024 * 1024),
          )} MB for ${spec.contentType} files.`,
        },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const timestamp = Date.now();
    const sanitizedName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 100);
    const storagePath = `${session.user.id}/${spec.contentType}/${timestamp}-${sanitizedName}`;

    const supabase = createAdminClient();

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError?.message?.toLowerCase().includes("bucket not found")) {
      const { error: createError } = await supabase.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 100 * 1024 * 1024,
      });

      if (createError) {
        return NextResponse.json(
          { error: `Storage bucket creation failed: ${createError.message}` },
          { status: 500 },
        );
      }

      const { error: retryError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (retryError) {
        return NextResponse.json(
          { error: `Storage upload failed after creating bucket: ${retryError.message}` },
          { status: 500 },
        );
      }
    } else if (uploadError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 },
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    return NextResponse.json({
      url: publicUrl,
      contentType: spec.contentType,
      mimeType: file.type,
      fileName: file.name,
    });
  } catch (error) {
    console.error("Media upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
