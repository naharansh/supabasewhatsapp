"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FolderOpen,
  Plus,
  Loader2,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  Check,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Gallery {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  gallery_images: { count: number }[];
}

export function GalleryList() {
  const router = useRouter();
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showRename, setShowRename] = useState<Gallery | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/galleries");
        if (!res.ok) throw new Error("Failed to load galleries");
        const data = await res.json();
        if (!cancelled) setGalleries(data.galleries ?? []);
      } catch (err) {
        if (!cancelled) {
          toast.error("Failed to load galleries", {
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
  }, []);

  const createGallery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/galleries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? res.statusText);
      }

      const data = await res.json();
      setGalleries((prev) => [
        { ...data.gallery, gallery_images: [{ count: 0 }] },
        ...prev,
      ]);
      setName("");
      setDescription("");
      setShowCreate(false);
      toast.success("Gallery created");
    } catch (err) {
      toast.error("Failed to create gallery", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  const renameGallery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showRename || !name.trim()) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/galleries/${showRename.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? res.statusText);
      }

      const data = await res.json();
      setGalleries((prev) =>
        prev.map((g) =>
          g.id === showRename.id
            ? { ...g, name: data.gallery.name, description: data.gallery.description }
            : g,
        ),
      );
      setShowRename(null);
      toast.success("Gallery updated");
    } catch (err) {
      toast.error("Failed to update gallery", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteGallery = async (gallery: Gallery) => {
    setDeletingId(gallery.id);
    try {
      const res = await fetch(`/api/galleries/${gallery.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? res.statusText);
      }

      setGalleries((prev) => prev.filter((g) => g.id !== gallery.id));
      toast.success("Gallery deleted");
    } catch (err) {
      toast.error("Failed to delete gallery", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const copyLink = async (gallery: Gallery) => {
    const url = `${window.location.origin}/gallery/${gallery.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(gallery.id);
      toast.success("Gallery link copied");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const openRename = (gallery: Gallery) => {
    setName(gallery.name);
    setDescription(gallery.description ?? "");
    setShowRename(gallery);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {galleries.length} {galleries.length === 1 ? "gallery" : "galleries"}
        </p>
        <Button onClick={() => { setName(""); setDescription(""); setShowCreate(true); }}>
          <Plus className="size-4" />
          New Gallery
        </Button>
      </div>

      {galleries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
          <FolderOpen className="size-12" />
          <p className="text-sm">No galleries yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {galleries.map((gallery) => (
            <Card
              key={gallery.id}
              className="group cursor-pointer border-slate-800 bg-slate-900/50 transition-colors hover:border-slate-700"
              onClick={() => router.push(`/gallery/${gallery.id}`)}
            >
              <CardContent className="p-5">
                <div className="mb-4 flex aspect-video items-center justify-center rounded-lg bg-slate-800">
                  <ImageIcon className="size-10 text-slate-600" />
                </div>

                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate font-medium text-white">
                      {gallery.name}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="-mr-2 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white focus:outline-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-slate-900 text-slate-100 ring-slate-700"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openRename(gallery);
                          }}
                          className="text-slate-200 focus:bg-slate-800 focus:text-white"
                        >
                          <Pencil className="size-4" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            copyLink(gallery);
                          }}
                          className="text-slate-200 focus:bg-slate-800 focus:text-white"
                        >
                          {copiedId === gallery.id ? (
                            <Check className="size-4" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                          Copy link
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteGallery(gallery);
                          }}
                          disabled={deletingId === gallery.id}
                          className="text-red-400 focus:bg-red-900/30 focus:text-red-300"
                        >
                          {deletingId === gallery.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {gallery.description && (
                    <p className="line-clamp-2 text-xs text-slate-500">
                      {gallery.description}
                    </p>
                  )}

                  <p className="pt-1 text-xs text-slate-600">
                    {gallery.gallery_images[0]?.count ?? 0} images &middot;{" "}
                    {formatDate(gallery.created_at)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="border-slate-800 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-white">New Gallery</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create a collection to organize your images.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createGallery}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gallery-name" className="text-slate-200">
                  Name
                </Label>
                <Input
                  id="gallery-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Gallery"
                  maxLength={120}
                  required
                  className="border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gallery-desc" className="text-slate-200">
                  Description (optional)
                </Label>
                <Textarea
                  id="gallery-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short description..."
                  rows={3}
                  className="border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreate(false)}
                className="border-slate-700 text-slate-300"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Gallery"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!showRename}
        onOpenChange={(open) => { if (!open) setShowRename(null); }}
      >
        <DialogContent className="border-slate-800 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-white">Rename Gallery</DialogTitle>
            <DialogDescription className="text-slate-400">
              Update the name or description.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={renameGallery}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rename-name" className="text-slate-200">
                  Name
                </Label>
                <Input
                  id="rename-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  required
                  className="border-slate-700 bg-slate-800 text-slate-100"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rename-desc" className="text-slate-200">
                  Description (optional)
                </Label>
                <Textarea
                  id="rename-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="border-slate-700 bg-slate-800 text-slate-100"
                />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowRename(null)}
                className="border-slate-700 text-slate-300"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
