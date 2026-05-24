import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { ComposerMention } from "@/lib/agent/composer-context";
import type { ChatPaneHandle } from "@/lib/agent/session";

export type ChatPaneFileMentionRow = {
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
  useEffect(() => {
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
  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.kind, mention?.query, setMentionIndex]);

  useEffect(() => {
    if (!mention || mention.kind !== "plugin" || !cwd) {
      setFileMentionRows([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/agent/fs?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          payload: {
            entries?: Array<{ name: string; rel: string; path: string; kind: string }>;
          } | null,
        ) => {
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
        },
      )
      .catch(() => {
        if (!cancelled) setFileMentionRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, mention, setFileMentionRows]);
}

export function useChatPaneRegisterHandleEffect({
  handleRef,
  onRegisterHandle,
}: {
  handleRef: RefObject<ChatPaneHandle>;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
}): void {
  useEffect(() => {
    if (!onRegisterHandle) return;
    const handle: ChatPaneHandle = {
      loadAndReplay: (id) => handleRef.current.loadAndReplay(id),
      compact: () => handleRef.current.compact(),
    };
    onRegisterHandle(handle);
    return () => onRegisterHandle(null);
  }, [handleRef, onRegisterHandle]);
}
