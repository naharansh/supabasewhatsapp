"use client";

import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { Send, LayoutTemplate, Paperclip, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (
    file: File,
    caption: string,
    mediaType: "image" | "video" | "audio" | "document",
    replyToId?: string,
  ) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onSendMedia,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, onSend, replyTo?.id]);

  const onClearFile = useCallback(() => {
    setPickedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleSendMedia = useCallback(async () => {
    if (!pickedFile || sending || sessionExpired) return;

    const mediaType = getMediaType(pickedFile.type);
    if (!mediaType) {
      onClearFile();
      return;
    }

    setSending(true);
    try {
      onSendMedia(pickedFile, text.trim(), mediaType, replyTo?.id);
      setPickedFile(null);
      setText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [pickedFile, sending, sessionExpired, onSendMedia, text, replyTo?.id, onClearFile]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (pickedFile) handleSendMedia();
        else handleSend();
      }
    },
    [handleSend, handleSendMedia, pickedFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  const handleFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setPickedFile(file);
    },
    []
  );

  const canSubmit = Boolean(pickedFile) || Boolean(text.trim());

  return (
    <div className="border-t border-slate-800 bg-slate-900 p-3">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}

      {/* Picked file preview chip */}
      {pickedFile && !sessionExpired && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-700">
            {pickedFile.type.startsWith("image/") && !pickedFile.type.startsWith("image/gif") ? (
              <img
                src={URL.createObjectURL(pickedFile)}
                alt={pickedFile.name}
                className="h-9 w-9 rounded-md object-cover"
              />
            ) : (
              <FileText className="h-4 w-4 text-slate-300" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white">{pickedFile.name}</p>
            <p className="text-[10px] text-slate-500">
              {getMediaType(pickedFile.type) ?? "unsupported"} • {formatFileSize(pickedFile.size)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0 text-slate-400 hover:text-white"
            onClick={onClearFile}
            title="Remove attachment"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            24-hour session expired. Use a template to re-engage.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            Templates
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Attachment button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
          onClick={() => fileInputRef.current?.click()}
          title="Attach media"
          disabled={sessionExpired}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/mpeg,audio/ogg,audio/amr,application/pdf,application/msword,application/vnd.ms-powerpoint,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
          className="hidden"
          onChange={handleFileSelected}
        />

        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
          onClick={onOpenTemplates}
          title="Send template"
        >
          <LayoutTemplate className="h-4 w-4" />
        </Button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            sessionExpired
              ? "Session expired - use a template"
              : pickedFile
                ? "Add a caption..."
                : "Type a message... (Shift+Enter for new line)"
          }
          disabled={sessionExpired}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
            sessionExpired && "cursor-not-allowed opacity-50"
          )}
        />

        <Button
          size="sm"
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
          disabled={!canSubmit || sessionExpired || sending}
          onClick={() => (pickedFile ? handleSendMedia() : handleSend())}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge (w-9 button + gap-2 = 44px). */}
      <p className="mt-1 pl-[4.5rem] text-[10px] text-slate-600">
        Type &apos;/&apos; for quick replies
      </p>
    </div>
  );
}

export function getMediaType(
  mimeType: string,
): "image" | "video" | "audio" | "document" | null {
  if (mimeType === "image/jpeg" || mimeType === "image/png") return "image";
  if (mimeType === "video/mp4" || mimeType === "video/3gpp") return "video";
  if (mimeType === "audio/mpeg" || mimeType === "audio/ogg" || mimeType === "audio/amr")
    return "audio";
  if (
    mimeType === "application/pdf" ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.ms-powerpoint" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "text/plain"
  )
    return "document";
  return null;
}
