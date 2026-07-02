"use client";

import { useState } from "react";
import { ImageGallery } from "@/components/gallery/image-gallery";
import { GalleryHeader } from "@/components/gallery/gallery-header";

export default function GalleryDetailPage({
  params: paramsPromise,
}: {
  params: Promise<{ galleryId: string }>;
}) {
  const [galleryId, setGalleryId] = useState<string | null>(null);

  if (!galleryId) {
    paramsPromise.then((p) => setGalleryId(p.galleryId));
  }

  if (!galleryId) return null;

  return (
    <div className="space-y-6">
      <GalleryHeader galleryId={galleryId} />

      <ImageGallery galleryId={galleryId} />
    </div>
  );
}
