"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ImagePlus,
  Loader2,
  Trash2,
  Copy,
  Check,
  ImageOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface GalleryImage {
  id: string;
  user_id: string;
  original_name: string;
  storage_path: string;
  public_url: string;
  description: string | null;
  file_size: number;
  mime_type: string;
  created_at: string;
  gallery_id: string | null;
}

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const MAX_BYTES = 10 * 1024 * 1024;

interface ImageGalleryProps {
  galleryId?: string;
}

export function ImageGallery({ galleryId }: ImageGalleryProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (galleryId) params.set("gallery_id", galleryId);
        const res = await fetch(`/api/gallery?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load images");
        const data = await res.json();
        if (!cancelled) setImages(data.images ?? []);
      } catch (err) {
        if (!cancelled) {
          toast.error("Failed to load images", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [galleryId]);

  const uploadFile = async (file: File) => {
    if (!ALLOWED_MIME.has(file.type)) {
      toast.error("Unsupported file type", {
        description: "Use PNG, JPG, WebP, GIF, or AVIF.",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File too large", {
        description: "Maximum 10 MB.",
      });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (galleryId) formData.append("gallery_id", galleryId);

      const res = await fetch("/api/gallery", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? res.statusText);
      }

      const data = await res.json();
      setImages((prev) => [data.image, ...prev]);
      toast.success("Image uploaded");
    } catch (err) {
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    uploadFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const copyLink = async (image: GalleryImage) => {
    try {
      await navigator.clipboard.writeText(image.public_url);
      setCopiedId(image.id);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const deleteImage = async (image: GalleryImage) => {
    setDeleting(image.id);
    try {
      const res = await fetch(`/api/gallery/${image.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? res.statusText);
      }

      setImages((prev) => prev.filter((i) => i.id !== image.id));
      toast.success("Image deleted");
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setDeleting(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative flex cursor-pointer flex-col items-center justify-center
          rounded-xl border-2 border-dashed p-10 transition-colors
          ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-slate-700 hover:border-slate-500"
          }
        `}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-slate-400">Uploading...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <ImagePlus className="size-10 text-slate-500" />
            <div className="text-center">
              <p className="text-sm font-medium text-slate-300">
                Drop an image here, or click to browse
              </p>
              <p className="mt-1 text-xs text-slate-500">
                PNG, JPG, WebP, GIF, or AVIF — up to 10 MB
              </p>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={onPickFile}
          disabled={uploading}
        />
      </div>

      {images.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
          <ImageOff className="size-12" />
          <p className="text-sm">No images yet. Upload your first image above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {images.map((image) => (
            <Card
              key={image.id}
              className="group overflow-hidden border-slate-800 bg-slate-900/50"
            >
              <div className="relative aspect-square overflow-hidden bg-slate-800">
                <img
                  src={image.public_url}
                  alt={image.original_name}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />

                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyLink(image);
                    }}
                    className="bg-white/90 text-slate-900 hover:bg-white"
                  >
                    {copiedId === image.id ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    {copiedId === image.id ? "Copied" : "Copy link"}
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteImage(image);
                    }}
                    disabled={deleting === image.id}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    {deleting === image.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              <CardContent className="space-y-1.5 p-3">
                <p className="truncate text-sm font-medium text-slate-200">
                  {image.original_name}
                </p>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{formatSize(image.file_size)}</span>
                  <span>{formatDate(image.created_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
