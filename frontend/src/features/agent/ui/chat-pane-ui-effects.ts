import { useRef, type Dispatch, type SetStateAction } from "react";
import { Effect } from "effect";
import type { ComposerMention } from "@/features/agent/composer-context";
import { newId } from "@/features/agent/messages";
import type { ContextAttachRequest } from "@/features/agent/tools/types";
import { attachmentDedupKey, type ChatAttachment } from "@/features/agent/ui/chat-attachments";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type ChatPaneFileMentionRow = {
  id: string;
  name: string;
  rel: string;
  path: string;
  source: string;
};

export function useChatPaneStickToBottomEffect({
  activeTabId,
  setStickToBottom,
}: {
  activeTabId: string | null | undefined;
  setStickToBottom: Dispatch<SetStateAction<boolean>>;
}): void {
  useMountSubscription(() => {
    setStickToBottom(true);
  }, [activeTabId, setStickToBottom]);
}

export function useChatPaneMentionEffects({
  cwd,
  mention,
  setFileMentionRows,
  setMentionIndex,
}: {
  cwd: string;
  mention: ComposerMention | null;
  setFileMentionRows: Dispatch<SetStateAction<ChatPaneFileMentionRow[]>>;
  setMentionIndex: Dispatch<SetStateAction<number>>;
}): void {
  useMountSubscription(() => {
    setMentionIndex(0);
  }, [mention?.kind, mention?.query, setMentionIndex]);

  useMountSubscription(() => {
    if (!mention || mention.kind !== "file" || !cwd) {
      setFileMentionRows([]);
      return;
    }
    let cancelled = false;
    void Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () => fetch(`/api/agent/fs?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }),
          catch: (error) => error,
        });
        const payload = response.ok
          ? yield* Effect.tryPromise({
              try: () =>
                response.json() as Promise<{
                  entries?: Array<{ name: string; rel: string; path: string; kind: string }>;
                }>,
              catch: (error) => error,
            })
          : null;
        if (cancelled) return;
        const rows = (payload?.entries ?? [])
          .filter((entry) => entry.kind === "file")
          .map((entry) => ({
            id: `file:${entry.rel}`,
            name: entry.name,
            rel: entry.rel,
            path: entry.path,
            source: "project",
          }));
        setFileMentionRows(rows);
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            if (!cancelled) setFileMentionRows([]);
          }),
        ),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [cwd, mention, setFileMentionRows]);
}

export function useChatPaneContextAttachEffect({
  contextAttachRequest,
  isFocused,
  setAttachments,
}: {
  contextAttachRequest: ContextAttachRequest | null;
  isFocused: boolean;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
}): void {
  const handledContextAttachRef = useRef(0);
  useMountSubscription(() => {
    if (
      contextAttachRequest &&
      isFocused &&
      handledContextAttachRef.current !== contextAttachRequest.id
    ) {
      handledContextAttachRef.current = contextAttachRequest.id;
      const attachment: ChatAttachment = {
        id: newId("ctx"),
        name: contextAttachRequest.label,
        type: "text/plain",
        size: contextAttachRequest.content.length,
        ...(contextAttachRequest.path ? { path: contextAttachRequest.path } : {}),
        mode: "text",
        content: contextAttachRequest.content,
        previewKind: "file",
      };
      setAttachments((current) => {
        const nextKey = attachmentDedupKey(attachment);
        if (current.some((file) => attachmentDedupKey(file) === nextKey)) return current;
        return [...current, attachment];
      });
    }
  }, [contextAttachRequest, isFocused, setAttachments]);
}
