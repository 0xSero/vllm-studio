"use client";

import { useState } from "react";
import { ChevronDown, Copy, X } from "@/ui/icon-registry";
import { useCopiedFlag } from "@/features/agent/ui/use-copied-flag";
import type { ChatMessage, ChatMessageAttachment } from "@/features/agent/messages";
import { AssistantActionButton } from "@/features/agent/ui/timeline/assistant-message-actions";
import { writeClipboardText } from "@/lib/clipboard";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function UserAttachmentPreview({
  attachment,
  onExpand,
}: {
  attachment: ChatMessageAttachment;
  onExpand?: () => void;
}) {
  const size = formatAttachmentSize(attachment.size);
  const title = `${attachment.name} · ${attachment.type} · ${size}${attachment.path ? ` · ${attachment.path}` : ""}`;
  if (attachment.previewKind === "image" && attachment.previewUrl) {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="overflow-hidden rounded-md border border-(--border) bg-black/40 p-0"
        title={title}
        aria-label={`Expand ${attachment.name}`}
      >
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          loading="lazy"
          className="aspect-[4/3] max-h-72 min-h-32 w-full object-contain"
        />
        <figcaption className="truncate px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {attachment.name} · {size}
        </figcaption>
      </button>
    );
  }
  if (attachment.previewKind === "video" && attachment.previewUrl) {
    return (
      <figure
        className="overflow-hidden rounded-md border border-(--border) bg-black/40 p-0"
        title={title}
      >
        <video src={attachment.previewUrl} className="max-h-72 w-full" controls />
        <figcaption className="truncate px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {attachment.name} · {size}
        </figcaption>
      </figure>
    );
  }
  if (attachment.previewKind === "audio" && attachment.previewUrl) {
    return (
      <figure className="rounded-md border border-(--border) bg-black/30 p-2" title={title}>
        <audio src={attachment.previewUrl} className="w-full" controls />
        <figcaption className="truncate pt-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {attachment.name} · {size}
        </figcaption>
      </figure>
    );
  }
  if (attachment.previewKind === "pdf" && attachment.previewUrl) {
    return (
      <div
        className="overflow-hidden rounded-md border border-(--border) bg-black/40 p-0"
        title={title}
      >
        <iframe
          src={attachment.previewUrl}
          title={attachment.name}
          className="h-72 w-full border-0 bg-(--bg)"
        />
        <div className="truncate px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {attachment.name} · {size}
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-md border border-(--border) bg-black/30 px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--dim)"
      title={title}
    >
      <span className="truncate">{attachment.name}</span>
      <span className="shrink-0">{size}</span>
    </div>
  );
}

function ExpandedImage({
  attachment,
  onClose,
}: {
  attachment: ChatMessageAttachment;
  onClose: () => void;
}) {
  useMountSubscription(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  if (!attachment.previewUrl) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-full max-w-full flex-col overflow-hidden rounded-[var(--rad-lg)] border border-white/15 bg-(--color-popover) shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close image preview"
        >
          <X className="h-4 w-4" />
        </button>
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          className="max-h-[calc(100vh-6rem)] max-w-[calc(100vw-4rem)] object-contain"
        />
        <div className="border-t border-(--border) px-3 py-2 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {attachment.name} · {formatAttachmentSize(attachment.size)}
        </div>
      </div>
    </div>
  );
}

function UserMessageAttachments({
  attachments,
  onExpandImage,
}: {
  attachments: ChatMessageAttachment[] | undefined;
  onExpandImage: (attachment: ChatMessageAttachment) => void;
}) {
  const images =
    attachments?.filter(
      (attachment) => attachment.previewKind === "image" && attachment.previewUrl,
    ) ?? [];
  const others =
    attachments?.filter(
      (attachment) => attachment.previewKind !== "image" || !attachment.previewUrl,
    ) ?? [];
  return (
    <>
      {images.length ? (
        <div className={`mt-2 grid gap-2 ${images.length > 1 ? "grid-cols-2" : ""}`}>
          {images.map((attachment) => (
            <UserAttachmentPreview
              key={attachment.id}
              attachment={attachment}
              onExpand={() => onExpandImage(attachment)}
            />
          ))}
        </div>
      ) : null}
      {others.length ? (
        <div className="mt-2 grid gap-2">
          {others.map((attachment) => (
            <UserAttachmentPreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
    </>
  );
}

export function UserMessage({ message }: { message: ChatMessage }) {
  const [copied, markCopied] = useCopiedFlag();
  const [expanded, setExpanded] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ChatMessageAttachment | null>(null);
  const copy = async () => {
    if (!message.text.trim()) return;
    await writeClipboardText(message.text);
    markCopied();
  };
  const pending = message.pending === true;
  const collapsible = message.text.length > 600 || message.text.split("\n").length > 8;
  return (
    <>
      <article className="group flex items-start justify-end gap-1">
        {message.text.trim() && !pending ? (
          <div className="mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <AssistantActionButton
              label={copied ? "Copied" : "Copy message"}
              onClick={() => void copy()}
            >
              <Copy className="h-3.5 w-3.5" />
            </AssistantActionButton>
          </div>
        ) : null}
        <div
          className={`min-w-0 max-w-[min(80%,42rem)] rounded-[var(--rad-lg)] bg-(--bubble) px-3 py-2 text-[length:var(--codex-chat-font-size)] leading-[1.45] text-(--fg)/85 transition-opacity duration-500 ${pending ? "opacity-45" : "opacity-100"}`}
        >
          {message.text ? (
            <div className="relative">
              <div
                className={`whitespace-pre-wrap break-words ${collapsible && !expanded ? "line-clamp-8 max-h-[11.6em] overflow-hidden" : ""}`}
              >
                {message.text}
              </div>
              {collapsible && !expanded ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-(--bubble) to-transparent" />
              ) : null}
            </div>
          ) : null}
          {collapsible ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1.5 inline-flex h-6 items-center gap-1 rounded px-1 text-[length:var(--fs-xs)] font-medium text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
              aria-expanded={expanded}
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
              {expanded ? "Show less" : "Show full message"}
            </button>
          ) : null}
          <UserMessageAttachments
            attachments={message.attachments}
            onExpandImage={setExpandedImage}
          />
        </div>
      </article>
      {expandedImage ? (
        <ExpandedImage attachment={expandedImage} onClose={() => setExpandedImage(null)} />
      ) : null}
    </>
  );
}
