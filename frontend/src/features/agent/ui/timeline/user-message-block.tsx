import { Copy } from "@/ui/icon-registry";
import { useCopiedFlag } from "@/features/agent/ui/use-copied-flag";
import type { ChatMessage, ChatMessageAttachment } from "@/features/agent/messages";
import { AssistantActionButton } from "@/features/agent/ui/timeline/assistant-message-actions";
import { writeClipboardText } from "@/lib/clipboard";

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MEDIA_CARD = "overflow-hidden rounded-md border border-(--border) bg-black/40 p-0";
const MEDIA_CAPTION = "truncate px-2 py-1 font-mono text-[length:var(--fs-xs)] text-(--dim)";

function UserAttachmentPreview({ attachment }: { attachment: ChatMessageAttachment }) {
  const size = formatAttachmentSize(attachment.size);
  const title = `${attachment.name} · ${attachment.type} · ${size}${attachment.path ? ` · ${attachment.path}` : ""}`;
  const caption = (
    <>
      {attachment.name} · {size}
    </>
  );
  const url = attachment.previewUrl;
  if (url && attachment.previewKind === "image") {
    return (
      <figure className={MEDIA_CARD} title={title}>
        <img
          src={url}
          alt={attachment.name}
          // Reserve vertical space so the async image decode doesn't grow from
          // 0 → up to 288px and shove the whole transcript below it (the scroller
          // runs overflow-anchor:none, so nothing absorbs that reflow).
          className="max-h-72 min-h-40 w-full object-contain"
        />
        <figcaption className={MEDIA_CAPTION}>{caption}</figcaption>
      </figure>
    );
  }
  if (url && attachment.previewKind === "video") {
    return (
      <figure className={MEDIA_CARD} title={title}>
        <video src={url} className="max-h-72 w-full" controls />
        <figcaption className={MEDIA_CAPTION}>{caption}</figcaption>
      </figure>
    );
  }
  if (url && attachment.previewKind === "audio") {
    return (
      <figure className="rounded-md border border-(--border) bg-black/30 p-2" title={title}>
        <audio src={url} className="w-full" controls />
        <figcaption className="truncate pt-1 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {caption}
        </figcaption>
      </figure>
    );
  }
  if (url && attachment.previewKind === "pdf") {
    return (
      <div className={MEDIA_CARD} title={title}>
        <iframe src={url} title={attachment.name} className="h-72 w-full border-0 bg-(--bg)" />
        <div className={MEDIA_CAPTION}>{caption}</div>
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

export function UserMessage({ message }: { message: ChatMessage }) {
  const [copied, markCopied] = useCopiedFlag();
  const copy = async () => {
    if (!message.text.trim()) return;
    await writeClipboardText(message.text);
    markCopied();
  };
  // A quiet foreground-tinted block sized to its content, capped by the same
  // composer-width column and anchored to its right edge. A copy button reveals
  // on hover to the left of the bubble, mirroring the assistant's copy action.
  // A steer message shows dimmed the instant it's sent and brightens once the
  // runtime echoes it (the model is now seeing it). The transition makes that
  // hand-off read as "delivered" rather than a sudden pop-in.
  const pending = message.pending === true;
  return (
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
        className={`min-w-0 max-w-full rounded-lg bg-(--bubble) px-4 py-2 text-[length:var(--codex-chat-font-size)] leading-[1.5] text-(--fg)/85 transition-opacity duration-500 ${pending ? "opacity-45" : "opacity-100"}`}
      >
        <div className="whitespace-pre-wrap break-words">{message.text}</div>
        {message.attachments?.length ? (
          <div className="mt-2 grid gap-2">
            {message.attachments.map((attachment) => (
              <UserAttachmentPreview key={attachment.id} attachment={attachment} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
