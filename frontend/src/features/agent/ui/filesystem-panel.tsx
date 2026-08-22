"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  Code,
  File,
  FolderTree,
  Monitor,
  Minus,
  MessageSquarePlus,
  Plus,
  Save,
  SquarePen,
} from "@/ui/icon-registry";
import { useAppStore } from "@/store";
import { useToolSelections, useToolsActions } from "@/features/agent/tools/context";
import type { FileComment, FsEntry } from "@/features/agent/filesystem-types";
import { FileViewer } from "@/features/agent/ui/filesystem-file-viewer";
import {
  ImagePreview,
  RenderedPreview,
  isBinaryPreviewKind,
  previewKindForOpenFile,
  rawFileUrl,
} from "@/features/agent/ui/filesystem-preview";
import { FileOpenActions } from "@/features/agent/ui/file-open-actions";
import { Breadcrumb, fileTone, TreeFileList } from "@/features/agent/ui/filesystem-tree";
import { resolveFileOpenTarget } from "@/features/agent/ui/file-open-target";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { FILESYSTEM_CHANGED_EVENT } from "@/lib/workspace-events";

type Props = { cwd: string | null };

const VIEW_MODE_TOGGLES = [
  ["preview", Monitor],
  ["code", Code],
] as const;

function FontSizeStep({ delta, size }: { delta: -1 | 1; size: number }) {
  const setFontSize = useAppStore((s) => s.setFileViewerFontSize);
  const Icon = delta < 0 ? Minus : Plus;
  return (
    <button
      type="button"
      onClick={() => setFontSize(delta < 0 ? Math.max(8, size - 1) : Math.min(20, size + 1))}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-(--dim) hover:text-(--fg)"
      title={`${delta < 0 ? "Decrease" : "Increase"} font size`}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}
// eslint-disable-next-line complexity
export function FilesystemPanel({ cwd }: Props) {
  // A file reference can point outside the session project (a PDF on the
  // Desktop). The panel then adopts that file's own directory as its root
  // instead of refusing to open it; `cwd` remains the project to return to.
  const [rootOverride, setRootOverride] = useState<string | null>(null);
  // Normalized once here so every root comparison (override vs project, parked
  // open request vs current root) comes down to plain string equality.
  const projectRoot = cwd ? cwd.replace(/\/+$/, "") : null;
  const root = rootOverride ?? projectRoot;
  const [relPath, setRelPath] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [draftContent, setDraftContent] = useState<string>("");
  const [fileTruncated, setFileTruncated] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [comments, setComments] = useState<FileComment[]>([]);
  const [viewMode, setViewMode] = useState<"preview" | "code" | "edit">("code");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirChildren, setDirChildren] = useState<Map<string, FsEntry[]>>(new Map());
  const [dirLoading, setDirLoading] = useState<Set<string>>(new Set());
  const [fileListOpen, setFileListOpen] = useState(true);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const { fileOpenRequest } = useToolSelections();
  const { requestContextAttach } = useToolsActions();
  const fontSize = useAppStore((s) => s.fileViewerFontSize);
  const lastOpenFileByProject = useAppStore((s) => s.lastOpenFileByProject);
  const setLastOpenFileByProject = useAppStore((s) => s.setLastOpenFileByProject);
  const rootRef = useRef(root);
  const pendingEditRef = useRef<{ caret: number; insert: string | null } | null>(null);
  const previewKind = useMemo(() => previewKindForOpenFile(openFile), [openFile]);
  const binaryPreview = isBinaryPreviewKind(previewKind);
  const dirty = draftContent !== fileContent;
  const fileName = openFile ? (openFile.split("/").pop() ?? openFile) : "";
  useMountSubscription(() => {
    const refresh = () => setRefreshRevision((revision) => revision + 1);
    window.addEventListener(FILESYSTEM_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FILESYSTEM_CHANGED_EVENT, refresh);
  }, []);
  const handledFileOpenRequest = useRef(0);
  // A file-open request can land on a root the panel is not showing yet (an
  // absolute path outside the session project). Switching roots re-runs the
  // reset effect below, which would wipe the file we were asked to open, so the
  // request parks its target here and the reset effect adopts it.
  const pendingOpen = useRef<{ root: string; rel: string; relPath: string } | null>(null);
  // Root whose open file came from a request, so the "restore last file"
  // effect does not immediately replace it with a remembered one.
  const pendingApplied = useRef<string | null>(null);

  useMountSubscription(() => {
    rootRef.current = root;
  }, [root]);

  // Switching session/project drops any external root the panel had adopted.
  useMountSubscription(() => {
    setRootOverride(null);
  }, [projectRoot]);

  useMountSubscription(() => {
    const pending = pendingOpen.current;
    const adopted = pending && pending.root === root ? pending : null;
    pendingOpen.current = null;
    pendingApplied.current = adopted ? root : null;
    setRelPath(adopted?.relPath ?? "");
    setOpenFile(adopted?.rel ?? null);
    setFileContent("");
    setDraftContent("");
    setFileTruncated(false);
    setFileSize(0);
    setSaveError(null);
    setComments([]);
    setSearchQuery("");
    setExpandedDirs(new Set());
    setDirChildren(new Map());
    setDirLoading(new Set());
  }, [root]);

  useMountSubscription(() => {
    if (!root) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/agent/fs?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as { entries?: FsEntry[]; error?: string };
        if (!cancelled) setEntries(payload.entries ?? []);
      } catch {
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root, relPath, refreshRevision]);

  useMountSubscription(() => {
    if (!root || pendingApplied.current === root) return;
    const remembered = lastOpenFileByProject[root];
    if (remembered) setOpenFile(remembered);
  }, [root, lastOpenFileByProject]);

  useMountSubscription(() => {
    if (!fileOpenRequest || handledFileOpenRequest.current === fileOpenRequest.id) {
      return;
    }
    handledFileOpenRequest.current = fileOpenRequest.id;
    const target = resolveFileOpenTarget(fileOpenRequest.path, projectRoot);
    if (!target) return;
    // Returning to the session project clears the override rather than pinning
    // an identical root, so the "external root" bar stays off.
    const nextOverride = target.root === projectRoot ? null : target.root;
    if ((nextOverride ?? projectRoot) !== root) {
      // Park the target for the reset effect that the root change triggers.
      pendingOpen.current = {
        root: target.root,
        rel: target.kind === "directory" ? "" : target.rel,
        relPath: target.kind === "directory" ? target.rel : "",
      };
      setRootOverride(nextOverride);
      return;
    }
    if (target.kind === "directory") {
      setRelPath(target.rel);
      return;
    }
    setOpenFile(target.rel);
    if (root) setLastOpenFileByProject(root, target.rel);
  }, [projectRoot, root, fileOpenRequest, setLastOpenFileByProject]);

  useMountSubscription(() => {
    if (!root || !openFile || binaryPreview) {
      setFileContent("");
      setDraftContent("");
      setFileTruncated(false);
      setFileSize(0);
      setSaveError(null);
      setComments([]);
      return;
    }
    if (dirty) return;
    let cancelled = false;
    setLoadingFile(true);
    setSaveError(null);
    (async () => {
      try {
        const [fileResponse, commentsResponse] = await Promise.all([
          fetch(
            `/api/agent/fs/file?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(openFile)}`,
            { cache: "no-store" },
          ),
          fetch(
            `/api/agent/comments?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(openFile)}`,
            { cache: "no-store" },
          ),
        ]);
        const fileBody = (await fileResponse.json()) as {
          content?: string;
          truncated?: boolean;
          size?: number;
          error?: string;
        };
        const commentsBody = (await commentsResponse.json()) as { comments?: FileComment[] };
        if (cancelled) return;
        const nextContent = fileBody.content ?? "";
        setFileContent(nextContent);
        setDraftContent(nextContent);
        setFileTruncated(fileBody.truncated ?? false);
        setFileSize(fileBody.size ?? 0);
        setComments(commentsBody.comments ?? []);
        // A read that fails server-side (missing file, path outside an allowed
        // root) used to leave an empty pane with no explanation.
        if (!fileResponse.ok || fileBody.error) setSaveError(fileBody.error || "Read failed.");
      } catch {
        if (!cancelled) {
          setFileContent("");
          setDraftContent("");
          setComments([]);
          setSaveError("Read failed.");
        }
      } finally {
        if (!cancelled) setLoadingFile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root, openFile, binaryPreview, refreshRevision, dirty]);
  const fetchDirChildren = useCallback(
    async (dirRel: string) => {
      const requestRoot = root;
      if (!requestRoot) return;
      setDirLoading((prev) => new Set(prev).add(dirRel));
      try {
        const response = await fetch(
          `/api/agent/fs?cwd=${encodeURIComponent(requestRoot)}&path=${encodeURIComponent(dirRel)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as { entries?: FsEntry[]; error?: string };
        if (rootRef.current !== requestRoot) return;
        setDirChildren((prev) => new Map(prev).set(dirRel, payload.entries ?? []));
      } catch {
        if (rootRef.current !== requestRoot) return;
        setDirChildren((prev) => new Map(prev).set(dirRel, []));
      } finally {
        if (rootRef.current !== requestRoot) return;
        setDirLoading((prev) => {
          const next = new Set(prev);
          next.delete(dirRel);
          return next;
        });
      }
    },
    [root],
  );
  const openEntry = useCallback(
    (entry: FsEntry) => {
      if (entry.kind !== "directory") {
        setOpenFile(entry.rel);
        if (root) setLastOpenFileByProject(root, entry.rel);
      }
    },
    [root, setLastOpenFileByProject],
  );
  const toggleDir = useCallback(
    (rel: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(rel)) {
          next.delete(rel);
        } else {
          next.add(rel);
          if (!dirChildren.has(rel)) {
            void fetchDirChildren(rel);
          }
        }
        return next;
      });
    },
    [dirChildren, fetchDirChildren],
  );
  useMountSubscription(() => {
    if (refreshRevision === 0) return;
    for (const dir of expandedDirs) void fetchDirChildren(dir);
  }, [expandedDirs, fetchDirChildren, refreshRevision]);
  const lines = useMemo(() => fileContent.split("\n"), [fileContent]);
  const enterEditMode = useCallback(
    (line: number | null, insert: string | null) => {
      pendingEditRef.current = {
        caret: line === null ? 0 : lines.slice(0, line).join("\n").length,
        insert: line === null ? null : insert,
      };
      setViewMode("edit");
    },
    [lines],
  );
  const focusEditor = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node) return;
    node.focus();
    const pending = pendingEditRef.current;
    pendingEditRef.current = null;
    if (!pending) return;
    const caret = Math.min(pending.caret, node.value.length);
    if (pending.insert) {
      node.setRangeText(pending.insert, caret, caret, "end");
      setDraftContent(node.value);
    } else {
      node.setSelectionRange(caret, caret);
    }
  }, []);
  const saveFile = useCallback(async () => {
    if (!root || !openFile || fileTruncated) return;
    setSavingFile(true);
    setSaveError(null);
    try {
      const response = await fetch(
        `/api/agent/fs/file?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(openFile)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: draftContent }),
        },
      );
      const payload = (await response.json()) as {
        content?: string;
        truncated?: boolean;
        size?: number;
        error?: string;
      };
      if (!response.ok || payload.error) throw new Error(payload.error || "Save failed.");
      setFileContent(payload.content ?? draftContent);
      setDraftContent(payload.content ?? draftContent);
      setFileTruncated(payload.truncated ?? false);
      setFileSize(payload.size ?? draftContent.length);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingFile(false);
    }
  }, [root, draftContent, fileTruncated, openFile]);
  const addComment = useCallback(
    async (line: number, body: string) => {
      if (!root || !openFile || !body.trim()) return;
      try {
        const response = await fetch("/api/agent/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: root, path: openFile, line, body }),
        });
        const payload = (await response.json()) as { comment?: FileComment; error?: string };
        if (payload.comment) setComments((current) => [...current, payload.comment!]);
      } catch {}
      requestContextAttach({
        label: `${fileName} · L${line}`,
        path: openFile,
        content: `Comment on ${openFile} line ${line}: ${body.trim()}`,
      });
    },
    [root, openFile, fileName, requestContextAttach],
  );
  const removeComment = useCallback(
    async (id: string) => {
      if (!root || !openFile) return;
      setComments((current) => current.filter((comment) => comment.id !== id));
      try {
        await fetch(
          `/api/agent/comments?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(openFile)}&id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
      } catch {}
    },
    [root, openFile],
  );
  const attachCommentsToChat = useCallback(() => {
    if (!openFile || comments.length === 0) return;
    const ordered = [...comments].sort((a, b) => a.line - b.line);
    const body = ordered.map((comment) => `- Line ${comment.line}: ${comment.body}`).join("\n");
    requestContextAttach({
      label: `${fileName} · comments`,
      path: openFile,
      content: `Comments on ${openFile}:\n${body}`,
    });
  }, [comments, openFile, fileName, requestContextAttach]);
  if (!root) {
    return (
      <div className="flex h-full items-center justify-center text-center text-[length:var(--fs-sm)] text-(--dim)">
        Pick a project to browse its files.
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-(--color-panel)">
      {rootOverride ? (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-(--border) bg-(--color-header) px-2 text-[length:var(--fs-xs)] text-(--dim)">
          <button
            type="button"
            onClick={() => setRootOverride(null)}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-(--border) bg-(--color-input) px-1.5 text-(--dim) hover:text-(--fg)"
            title={projectRoot ? `Back to ${projectRoot}` : "Back to the project"}
          >
            <ArrowLeftIcon className="h-3 w-3" />
            Project
          </button>
          <span className="truncate font-mono" title={rootOverride}>
            {rootOverride}
          </span>
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-row-reverse">
        {fileListOpen ? (
          <div className="flex w-[236px] shrink-0 flex-col border-l border-(--border) bg-(--sidebar-bg)">
            <div className="flex h-9 shrink-0 items-center border-b border-(--border)">
              <div className="min-w-0 flex-1">
                <Breadcrumb relPath={relPath} onRoot={() => setRelPath("")} />
              </div>
              <button
                type="button"
                onClick={() => setFileListOpen(false)}
                className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                title="Collapse file list"
                aria-label="Collapse file list"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex shrink-0 border-b border-(--border) px-2 py-2">
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files…"
                className="h-7 w-full rounded-md border border-(--border) bg-(--color-input) px-2 text-[length:var(--fs-sm)] text-(--fg) outline-none placeholder:text-(--dim)/75 focus:border-(--border-hover)"
                spellCheck={false}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="ml-1 shrink-0 rounded-md px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              <TreeFileList
                entries={entries}
                searchQuery={searchQuery}
                openFile={openFile}
                onOpen={openEntry}
                onToggleDir={toggleDir}
                depth={0}
                expandedDirs={expandedDirs}
                dirChildren={dirChildren}
                dirLoading={dirLoading}
              />
              {entries.length === 0 && !searchQuery && (
                <div className="px-2 py-2 text-[length:var(--fs-sm)] text-(--dim)">Empty.</div>
              )}
            </div>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {!openFile ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[length:var(--fs-sm)] text-(--dim)">
              <span>Select a file to view.</span>
              {!fileListOpen ? (
                <button
                  type="button"
                  onClick={() => setFileListOpen(true)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-(--border) bg-(--color-input) px-2 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
                >
                  <FolderTree className="h-3.5 w-3.5" />
                  Show files
                </button>
              ) : null}
            </div>
          ) : previewKind === "image" ? (
            <>
              <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-(--border) bg-(--color-header) px-2">
                <div
                  className="flex min-w-0 items-center gap-1.5 text-[length:var(--fs-sm)] text-(--fg)"
                  title={openFile}
                >
                  <File className={`h-3.5 w-3.5 shrink-0 ${fileTone(openFile)}`} />
                  <span className="truncate font-mono">{fileName}</span>
                </div>
                <FileOpenActions root={root} relPath={openFile} compact />
              </div>
              <ImagePreview name={openFile} url={rawFileUrl(root, openFile)} />
            </>
          ) : binaryPreview || fileTruncated ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[length:var(--fs-sm)] text-(--dim)">
              <span className="max-w-full truncate font-mono text-(--fg)">{fileName}</span>
              <span>
                {binaryPreview
                  ? "PDFs open in your reader, not in this panel."
                  : "Binary or too large to render."}
                {fileSize > 0 ? ` — ${(fileSize / 1024).toFixed(1)} KB` : ""}
              </span>
              <FileOpenActions root={root} relPath={openFile} />
            </div>
          ) : loadingFile ? (
            <div className="flex h-full items-center justify-center text-[length:var(--fs-sm)] text-(--dim)">
              Loading…
            </div>
          ) : (
            <>
              <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-(--border) bg-(--color-header) pr-2">
                <div
                  className="relative flex h-full min-w-0 max-w-[55%] items-center gap-1.5 border-r border-(--border) bg-(--color-panel) px-3 text-[length:var(--fs-sm)] text-(--fg) after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-(--link)"
                  title={openFile}
                >
                  <File className={`h-3.5 w-3.5 shrink-0 ${fileTone(openFile)}`} />
                  <span className="truncate font-mono">{fileName}</span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {comments.length > 0 && (
                    <button
                      type="button"
                      onClick={attachCommentsToChat}
                      className="mr-1 inline-flex h-6 items-center gap-1 rounded-md border border-(--border) bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
                      title="Attach this file's comments to the chat as context"
                    >
                      <MessageSquarePlus className="h-3 w-3" />
                      {comments.length}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setViewMode("edit")}
                    className={`mr-1 inline-flex h-6 items-center gap-1 rounded-md border border-(--border) bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] ${viewMode === "edit" ? "text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
                    title="Edit file"
                  >
                    <SquarePen className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveFile()}
                    disabled={!dirty || savingFile || fileTruncated}
                    className="mr-1 inline-flex h-6 items-center gap-1 rounded-md border border-(--border) bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg) disabled:cursor-not-allowed disabled:opacity-40"
                    title={dirty ? "Save file" : "No changes to save"}
                  >
                    <Save className="h-3 w-3" />
                    {savingFile ? "Saving" : "Save"}
                  </button>
                  {previewKind && (
                    <div className="mr-1 flex items-center gap-0.5 rounded-md border border-(--border) bg-(--color-input) p-0.5">
                      {VIEW_MODE_TOGGLES.map(([mode, Icon]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setViewMode(mode)}
                          className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[length:var(--fs-xs)] ${viewMode === mode ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"}`}
                        >
                          <Icon className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-0.5 rounded-md border border-(--border) bg-(--color-input) p-0.5">
                    <FontSizeStep delta={-1} size={fontSize} />
                    <span className="w-5 text-center text-[length:var(--fs-2xs)] text-(--dim)">
                      {fontSize}
                    </span>
                    <FontSizeStep delta={1} size={fontSize} />
                  </div>
                  {!fileListOpen ? (
                    <button
                      type="button"
                      onClick={() => setFileListOpen(true)}
                      className="ml-1 inline-flex h-6 items-center gap-1 rounded-md border border-(--border) bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
                      title="Show file list"
                      aria-label="Show file list"
                    >
                      <FolderTree className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </div>
              {saveError ? (
                <div className="border-b border-(--err)/30 bg-(--err)/10 px-2 py-1 text-[length:var(--fs-xs)] text-(--err)">
                  {saveError}
                </div>
              ) : null}
              {viewMode === "edit" ? (
                <textarea
                  ref={focusEditor}
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  spellCheck={false}
                  className="min-h-0 flex-1 resize-none overflow-auto bg-(--bg) p-2 font-mono text-(--fg) outline-none"
                  style={{ fontSize, lineHeight: `${Math.round(fontSize * 1.5)}px` }}
                />
              ) : previewKind && viewMode === "preview" ? (
                <RenderedPreview content={fileContent} kind={previewKind} />
              ) : (
                <FileViewer
                  key={openFile}
                  filePath={openFile}
                  lines={lines}
                  fontSize={fontSize}
                  comments={comments}
                  onAddComment={addComment}
                  onRemoveComment={removeComment}
                  onRequestEdit={enterEditMode}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
