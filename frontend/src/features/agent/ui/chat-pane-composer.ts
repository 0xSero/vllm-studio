"use client";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { Effect } from "effect";
import {
  type FileMentionRow,
  type LoadedContextKind,
  type MentionRow,
} from "@/features/agent/ui/agent-composer-context";
import {
  byQuery,
  consumeComposerMention,
  detectComposerMention,
  type ComposerMention,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
import { type SessionTab } from "@/features/agent/messages";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import {
  attachmentDedupKey,
  createAttachment,
  createProjectFileAttachment,
  dataTransferHasFiles,
  filesFromDataTransfer,
  imageFileFromDataUrlText,
  type ChatAttachment,
} from "@/features/agent/ui/chat-attachments";

export type UpdateTab = (tabId: string, patch: (tab: SessionTab) => SessionTab) => void;

const getComposerSnapshot = (): number => 0;

type UseComposerAttachmentsOptions = {
  activeTab: SessionTab | null;
  running: boolean;
  updateTab: UpdateTab;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

export function useComposerAttachments({
  activeTab,
  running,
  updateTab,
  fileInputRef,
}: UseComposerAttachmentsOptions) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);

  const attachFiles = useCallback(
    (files: FileList | File[] | null) => {
      const fileArray = files ? Array.from(files) : [];
      if (fileArray.length === 0 || !activeTab) return Promise.resolve();
      if (running) {
        updateTab(activeTab.id, (tab) => ({
          ...tab,
          error: "Pause or wait for the current turn before attaching files.",
        }));
        return Promise.resolve();
      }
      setReadingAttachments(true);
      return Effect.runPromise(
        Effect.gen(function* () {
          const next = yield* Effect.all(
            fileArray.map((file) =>
              Effect.tryPromise({ try: () => createAttachment(file), catch: (error) => error }),
            ),
          );
          setAttachments((current) => {
            const seen = new Set(current.map(attachmentDedupKey));
            const uniqueNext: ChatAttachment[] = [];
            next.forEach((file) => {
              const key = attachmentDedupKey(file);
              if (seen.has(key)) return;
              seen.add(key);
              uniqueNext.push(file);
            });
            return [...current, ...uniqueNext];
          });
          updateTab(activeTab.id, (tab) => ({ ...tab, error: "" }));
        }).pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              updateTab(activeTab.id, (tab) => ({
                ...tab,
                error: err instanceof Error ? err.message : "Failed to attach file",
              }));
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              setReadingAttachments(false);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }),
          ),
        ),
      );
    },
    [activeTab, fileInputRef, running, updateTab],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [fileInputRef]);

  const handleComposerDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = running ? "none" : "copy";
      setComposerDragActive(true);
    },
    [running],
  );

  const handleComposerDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setComposerDragActive(false);
  }, []);

  const handleComposerDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      setComposerDragActive(false);
      void attachFiles(filesFromDataTransfer(event.dataTransfer));
    },
    [attachFiles],
  );

  return {
    attachments,
    setAttachments,
    readingAttachments,
    composerDragActive,
    attachFiles,
    removeAttachment,
    clearAttachments,
    handleComposerDragOver,
    handleComposerDragLeave,
    handleComposerDrop,
  };
}

export function useComposerLoadedContext({
  activeTab,
  tools,
}: {
  activeTab: SessionTab | null;
  tools: ToolsContextValue;
}) {
  const activeSelection = tools.selectionFor(activeTab?.id);
  const removeLoadedContext = useCallback(
    (kind: LoadedContextKind, id: string) => {
      if (!activeTab) return;
      const current = tools.selectionFor(activeTab.id);
      tools.setSelection(activeTab.id, {
        skills:
          kind === "skill" ? current.skills.filter((skill) => skill.id !== id) : current.skills,
        promptTemplates:
          kind === "promptTemplate"
            ? current.promptTemplates.filter((template) => template.id !== id)
            : current.promptTemplates,
      });
    },
    [activeTab, tools],
  );

  return {
    selectedSkills: activeSelection.skills,
    selectedPromptTemplates: activeSelection.promptTemplates,
    removeLoadedContext,
  };
}

type UseComposerMentionRowsOptions = {
  fileMentionRows: FileMentionRow[];
  mention: ComposerMention | null;
  promptTemplateRows: ComposerPromptTemplateRef[];
  skillRows: ComposerSkillRef[];
};

export function useComposerMentionRows({
  fileMentionRows,
  mention,
  promptTemplateRows,
  skillRows,
}: UseComposerMentionRowsOptions): MentionRow[] {
  return useMemo<MentionRow[]>(() => {
    if (!mention) return [];
    if (mention.kind === "skill") {
      return byQuery(skillRows, mention.query, 8).map((row) => ({ kind: "skill", row }));
    }
    if (mention.kind === "promptTemplate") {
      return byQuery(promptTemplateRows, mention.query, 8).map((row) => ({
        kind: "promptTemplate" as const,
        row,
      }));
    }
    const q = mention.query.trim().toLowerCase();
    const files = fileMentionRows
      .filter(
        (row) => !q || row.rel.toLowerCase().includes(q) || row.name.toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map((row) => ({ kind: "file" as const, row }));
    return files.slice(0, 8);
  }, [fileMentionRows, mention, promptTemplateRows, skillRows]);
}

type ContextRow = ComposerSkillRef | ComposerPromptTemplateRef;
type LoadedContextRow = {
  skill?: ComposerSkillRef;
  template?: ComposerPromptTemplateRef;
};

export function useComposerMentionSelection({
  activeTab,
  mention,
  cwd,
  tools,
  updateTab,
  setAttachments,
  setMention,
  textareaRef,
}: {
  activeTab: SessionTab | null;
  mention: ComposerMention | null;
  cwd: string;
  tools: Pick<ToolsContextValue, "selectionFor" | "setSelection">;
  updateTab: (tabId: string, patch: (tab: SessionTab) => SessionTab) => void;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  setMention: Dispatch<SetStateAction<ComposerMention | null>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return useCallback(
    (entry: MentionRow) => {
      if (!activeTab || !mention) return Promise.resolve();

      return Effect.runPromise(
        Effect.gen(function* () {
          if (entry.kind === "file") {
            const input = consumeComposerMention(activeTab.input, mention);
            updateTab(activeTab.id, (tab) => ({ ...tab, input }));
            const attachment = yield* loadProjectFileAttachmentEffect(cwd, entry.row);
            addUniqueAttachment(setAttachments, attachment);
          } else {
            const selectedRow = yield* loadContextRowEffect(entry.row, mention.kind);
            const input = consumeComposerMention(activeTab.input, mention);
            updateTab(activeTab.id, (tab) => ({ ...tab, input }));
            if (mention.kind !== "file") {
              applySelectedContext(activeTab.id, mention.kind, selectedRow, tools);
            }
          }

          setMention(null);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }),
      );
    },
    [activeTab, cwd, mention, setAttachments, setMention, textareaRef, tools, updateTab],
  );
}

function loadProjectFileAttachment(
  cwd: string,
  row: Extract<MentionRow, { kind: "file" }>["row"],
): Promise<ChatAttachment> {
  return Effect.runPromise(loadProjectFileAttachmentEffect(cwd, row));
}

function loadProjectFileAttachmentEffect(
  cwd: string,
  row: Extract<MentionRow, { kind: "file" }>["row"],
): Effect.Effect<ChatAttachment> {
  return Effect.gen(function* () {
    const loaded = yield* jsonOrNullEffect<{ content: string; truncated: boolean; size: number }>(
      `/api/agent/fs/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(row.rel)}`,
    );
    return createProjectFileAttachment({
      id: row.id,
      name: row.name,
      path: row.path,
      content: loaded?.content ?? "",
      truncated: loaded?.truncated ?? true,
      size: loaded?.size ?? 0,
    });
  });
}

function loadContextRow(row: ContextRow, kind: ComposerMention["kind"]): Promise<ContextRow> {
  return Effect.runPromise(loadContextRowEffect(row, kind));
}

function loadContextRowEffect(
  row: ContextRow,
  kind: ComposerMention["kind"],
): Effect.Effect<ContextRow> {
  if (!row.path) return Effect.succeed(row);
  const rowPath = row.path;
  return Effect.gen(function* () {
    const loaded = yield* jsonOrNullEffect<LoadedContextRow>(loadEndpoint(kind, rowPath));
    return loaded?.skill
      ? { ...row, ...loaded.skill, id: row.id }
      : loaded?.template
        ? { ...row, ...loaded.template, id: row.id }
        : row;
  });
}

function loadEndpoint(kind: ComposerMention["kind"], path: string): string {
  const encoded = encodeURIComponent(path);
  if (kind === "skill") return `/api/agent/skills/load?path=${encoded}`;
  return `/api/agent/prompt-templates/load?path=${encoded}`;
}

function applySelectedContext(
  sessionId: string,
  kind: ComposerMention["kind"],
  selectedRow: ContextRow,
  tools: Pick<ToolsContextValue, "selectionFor" | "setSelection">,
) {
  const current = tools.selectionFor(sessionId);
  if (kind === "skill" && !current.skills.some((skill) => skill.id === selectedRow.id)) {
    return tools.setSelection(sessionId, {
      ...current,
      skills: [...current.skills, selectedRow as ComposerSkillRef],
    });
  }
  if (
    kind === "promptTemplate" &&
    !current.promptTemplates.some((template) => template.id === selectedRow.id)
  ) {
    return tools.setSelection(sessionId, {
      ...current,
      promptTemplates: [...current.promptTemplates, selectedRow as ComposerPromptTemplateRef],
    });
  }
}

function addUniqueAttachment(
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>,
  attachment: ChatAttachment,
) {
  setAttachments((current) => {
    const nextKey = attachmentDedupKey(attachment);
    if (current.some((file) => attachmentDedupKey(file) === nextKey)) return current;
    return [...current, attachment];
  });
}

function jsonOrNull<T>(url: string): Promise<T | null> {
  return Effect.runPromise(jsonOrNullEffect<T>(url));
}

function jsonOrNullEffect<T>(url: string): Effect.Effect<T | null> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { cache: "no-store" }),
      catch: (error) => error,
    });
    if (!response?.ok) return null;
    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<T>,
      catch: (error) => error,
    });
  }).pipe(Effect.catch(() => Effect.succeed(null)));
}

export function useComposerTextareaHeightSync({
  value,
  textareaRef,
  lastAppliedComposerHeightRef,
  lastComposerValueLengthRef,
}: {
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  lastAppliedComposerHeightRef: MutableRefObject<number>;
  lastComposerValueLengthRef: MutableRefObject<number>;
}) {
  const subscribeHeightSync = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return () => undefined;

    if (!value) {
      node.style.height = "";
      node.scrollTop = 0;
      lastAppliedComposerHeightRef.current = 0;
      lastComposerValueLengthRef.current = 0;
      return () => undefined;
    }

    node.style.height = "auto";
    const next = node.scrollHeight;
    node.style.height = `${next}px`;
    lastAppliedComposerHeightRef.current = next;
    lastComposerValueLengthRef.current = value.length;
    return () => undefined;
  }, [lastAppliedComposerHeightRef, lastComposerValueLengthRef, textareaRef, value]);

  useSyncExternalStore(subscribeHeightSync, getComposerSnapshot, getComposerSnapshot);
}

export function useComposerTextareaBehavior({
  activeTab,
  mention,
  mentionRows,
  mentionIndex,
  running,
  textareaRef,
  lastAppliedComposerHeightRef,
  lastComposerValueLengthRef,
  resetComposerHeight,
  updateTab,
  setMention,
  setMentionIndex,
  selectMentionRow,
  queueMessage,
  abortTurn,
  attachFiles,
}: {
  activeTab: SessionTab | null;
  mention: ComposerMention | null;
  mentionRows: MentionRow[];
  mentionIndex: number;
  running: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  lastAppliedComposerHeightRef: MutableRefObject<number>;
  lastComposerValueLengthRef: MutableRefObject<number>;
  resetComposerHeight: () => void;
  updateTab: UpdateTab;
  setMention: Dispatch<SetStateAction<ComposerMention | null>>;
  setMentionIndex: Dispatch<SetStateAction<number>>;
  selectMentionRow: (entry: MentionRow) => Promise<void>;
  queueMessage: () => Promise<void>;
  abortTurn: () => Promise<void>;
  attachFiles: (files: FileList | File[] | null) => Promise<void>;
}) {
  const resizeAfterCommit = useCallback(
    (nextValue: string, nextCaret: number) => {
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.setSelectionRange(nextCaret, nextCaret);
        node.style.height = "auto";
        const next = node.scrollHeight;
        node.style.height = `${next}px`;
        lastAppliedComposerHeightRef.current = next;
        lastComposerValueLengthRef.current = nextValue.length;
      });
    },
    [lastAppliedComposerHeightRef, lastComposerValueLengthRef, textareaRef],
  );

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = filesFromDataTransfer(event.clipboardData);
      if (files.length === 0) {
        const text = event.clipboardData.getData("text/plain");
        const pastedImage = imageFileFromDataUrlText(text);
        if (pastedImage) {
          event.preventDefault();
          void attachFiles([pastedImage]);
          return;
        }
        if (!text || !activeTab) return;
        event.preventDefault();
        // Apply large text pastes as one controlled update to avoid composer resize flicker.
        const element = event.currentTarget;
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? element.value.length;
        const current = activeTab.input ?? "";
        const nextValue = current.slice(0, start) + text + current.slice(end);
        const nextCaret = start + text.length;
        updateTab(activeTab.id, (tab) => ({ ...tab, input: nextValue }));
        setMention(null);
        resizeAfterCommit(nextValue, nextCaret);
        return;
      }
      event.preventDefault();
      void attachFiles(files);
    },
    [activeTab, attachFiles, resizeAfterCommit, setMention, updateTab],
  );

  const handleComposerChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({ ...tab, input: value }));
      setMention(value ? detectComposerMention(value, event.currentTarget.selectionStart) : null);
      const element = event.currentTarget;
      if (!value) {
        resetComposerHeight();
        return;
      }
      const prevLength = lastComposerValueLengthRef.current;
      lastComposerValueLengthRef.current = value.length;
      const shrinking = value.length < prevLength;
      if (shrinking) element.style.height = "auto";
      const next = element.scrollHeight;
      if (!shrinking && next === lastAppliedComposerHeightRef.current) return;
      element.style.height = `${next}px`;
      lastAppliedComposerHeightRef.current = next;
    },
    [
      activeTab,
      lastAppliedComposerHeightRef,
      lastComposerValueLengthRef,
      resetComposerHeight,
      setMention,
      updateTab,
    ],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mention) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setMentionIndex((index) => {
            if (mentionRows.length === 0) return 0;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            return (index + delta + mentionRows.length) % mentionRows.length;
          });
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setMention(null);
          return;
        }
        if ((event.key === "Enter" || event.key === "Tab") && mentionRows[mentionIndex]) {
          event.preventDefault();
          void selectMentionRow(mentionRows[mentionIndex]);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        if (!activeTab?.input.trim()) return;
        event.preventDefault();
        void queueMessage();
        return;
      }
      if (event.key === "Escape" || (event.key === "." && (event.metaKey || event.ctrlKey))) {
        if (running) {
          event.preventDefault();
          void abortTurn();
        }
      }
    },
    [
      abortTurn,
      activeTab,
      mention,
      mentionIndex,
      mentionRows,
      queueMessage,
      running,
      selectMentionRow,
      setMention,
      setMentionIndex,
    ],
  );

  return {
    handleComposerPaste,
    handleComposerChange,
    handleComposerKeyDown,
  };
}
