"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, Loader2, Copy, Check } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface GalleryData {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  gallery_images: { count: number }[];
}

export function GalleryHeader({ galleryId }: { galleryId: string }) {
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/galleries/${galleryId}`);
        if (!res.ok) throw new Error("Failed to load gallery");
        const data = await res.json();
        if (!cancelled) setGallery(data.gallery);
      } catch (err) {
        if (!cancelled) {
          toast.error("Failed to load gallery", {
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

  const copyLink = async () => {
    const url = `${window.location.origin}/gallery/${galleryId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Gallery link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading gallery...</span>
      </div>
    );
  }

  if (!gallery) {
    return (
      <div>
        <Link
          href="/gallery"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
        >
          <ChevronLeft className="size-4" />
          Back to galleries
        </Link>
        <p className="text-slate-500">Gallery not found.</p>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/gallery"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ChevronLeft className="size-4" />
        Back to galleries
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{gallery.name}</h1>
          {gallery.description && (
            <p className="mt-1 text-sm text-slate-400">
              {gallery.description}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {gallery.gallery_images[0]?.count ?? 0} images
          </p>
        </div>

        <Button variant="outline" onClick={copyLink} className="shrink-0 border-slate-700 text-slate-300">
          {copied ? (
            <>
              <Check className="size-4" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-4" />
              Copy gallery link
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
