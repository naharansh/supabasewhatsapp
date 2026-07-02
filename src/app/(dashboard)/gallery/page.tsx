import { Image as ImageIcon } from "lucide-react";
import { GalleryList } from "@/components/gallery/gallery-list";

export const metadata = {
  title: "Image Gallery",
};

export default function GalleryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
          <ImageIcon className="size-6" />
          Image Gallery
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Create galleries to organize your images and generate shareable links.
        </p>
      </div>

      <GalleryList />
    </div>
  );
}
