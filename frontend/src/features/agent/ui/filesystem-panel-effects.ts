import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { FileOpenRequest } from "@/features/agent/tools/types";
import type { FileComment, FsEntry } from "@/features/agent/filesystem-types";

type UseFilesystemPanelEffectsParams = {
  cwd: string | null;
  relPath: string;
  openFile: string | null;
  fileOpenRequest: FileOpenRequest | null;
  lastOpenFileByProject: Record<string, string>;
  cwdRef: MutableRefObject<string | null>;
  setRelPath: Dispatch<SetStateAction<string>>;
  setEntries: Dispatch<SetStateAction<FsEntry[]>>;
  setOpenFile: Dispatch<SetStateAction<string | null>>;
  setFileContent: Dispatch<SetStateAction<string>>;
  setDraftContent: Dispatch<SetStateAction<string>>;
  setFileTruncated: Dispatch<SetStateAction<boolean>>;
  setFileSize: Dispatch<SetStateAction<number>>;
  setLoadingFile: Dispatch<SetStateAction<boolean>>;
  setSaveError: Dispatch<SetStateAction<string | null>>;
  setComments: Dispatch<SetStateAction<FileComment[]>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setExpandedDirs: Dispatch<SetStateAction<Set<string>>>;
  setDirChildren: Dispatch<SetStateAction<Map<string, FsEntry[]>>>;
  setDirLoading: Dispatch<SetStateAction<Set<string>>>;
  setLastOpenFileByProject: (projectPath: string, relPath: string) => void;
};

const getFilesystemPanelSnapshot = (): number => 0;

export function useFilesystemPanelEffects({
  cwd,
  relPath,
  openFile,
  fileOpenRequest,
  lastOpenFileByProject,
  cwdRef,
  setRelPath,
  setEntries,
  setOpenFile,
  setFileContent,
  setDraftContent,
  setFileTruncated,
  setFileSize,
  setLoadingFile,
  setSaveError,
  setComments,
  setSearchQuery,
  setExpandedDirs,
  setDirChildren,
  setDirLoading,
  setLastOpenFileByProject,
}: UseFilesystemPanelEffectsParams): void {
  const handledFileOpenRequest = useRef(0);

  const subscribeCwdRef = useCallback(() => {
    cwdRef.current = cwd;
    return () => undefined;
  }, [cwd, cwdRef]);

  const subscribeProjectReset = useCallback(() => {
    setRelPath("");
    setOpenFile(null);
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
    return () => undefined;
  }, [
    cwd,
    setComments,
    setDirChildren,
    setDirLoading,
    setDraftContent,
    setExpandedDirs,
    setFileContent,
    setFileSize,
    setFileTruncated,
    setSaveError,
    setOpenFile,
    setRelPath,
    setSearchQuery,
  ]);

  const subscribeEntries = useCallback(() => {
    if (!cwd) {
      setEntries([]);
      return () => undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/agent/fs?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(relPath)}`,
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
  }, [cwd, relPath, setEntries]);

  const subscribeRememberedFile = useCallback(() => {
    if (!cwd) return () => undefined;
    const remembered = lastOpenFileByProject[cwd];
    if (remembered) setOpenFile(remembered);
    return () => undefined;
  }, [cwd, lastOpenFileByProject, setOpenFile]);

  const subscribeFileOpenRequest = useCallback(() => {
    if (!fileOpenRequest || handledFileOpenRequest.current === fileOpenRequest.id) {
      return () => undefined;
    }
    handledFileOpenRequest.current = fileOpenRequest.id;
    const rel = relativePathForRequest(fileOpenRequest.path, cwd);
    if (!rel) return () => undefined;
    setOpenFile(rel);
    if (cwd) setLastOpenFileByProject(cwd, rel);
    return () => undefined;
  }, [cwd, fileOpenRequest, setLastOpenFileByProject, setOpenFile]);

  const subscribeOpenFile = useCallback(() => {
    if (!cwd || !openFile) {
      setFileContent("");
      setDraftContent("");
      setFileTruncated(false);
      setFileSize(0);
      setSaveError(null);
      setComments([]);
      return () => undefined;
    }
    let cancelled = false;
    setLoadingFile(true);
    setSaveError(null);
    (async () => {
      try {
        const [fileResponse, commentsResponse] = await Promise.all([
          fetch(
            `/api/agent/fs/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(openFile)}`,
            { cache: "no-store" },
          ),
          fetch(
            `/api/agent/comments?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(openFile)}`,
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
      } catch {
        if (!cancelled) {
          setFileContent("");
          setDraftContent("");
          setComments([]);
        }
      } finally {
        if (!cancelled) setLoadingFile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    cwd,
    openFile,
    setComments,
    setDraftContent,
    setFileContent,
    setFileSize,
    setFileTruncated,
    setLoadingFile,
    setSaveError,
  ]);

  useSyncExternalStore(subscribeCwdRef, getFilesystemPanelSnapshot, getFilesystemPanelSnapshot);
  useSyncExternalStore(
    subscribeProjectReset,
    getFilesystemPanelSnapshot,
    getFilesystemPanelSnapshot,
  );
  useSyncExternalStore(subscribeEntries, getFilesystemPanelSnapshot, getFilesystemPanelSnapshot);
  useSyncExternalStore(
    subscribeRememberedFile,
    getFilesystemPanelSnapshot,
    getFilesystemPanelSnapshot,
  );
  useSyncExternalStore(
    subscribeFileOpenRequest,
    getFilesystemPanelSnapshot,
    getFilesystemPanelSnapshot,
  );
  useSyncExternalStore(subscribeOpenFile, getFilesystemPanelSnapshot, getFilesystemPanelSnapshot);
}

function relativePathForRequest(path: string, cwd: string | null): string | null {
  let raw = path.trim();
  if (!raw) return null;
  if (/^file:\/\//i.test(raw)) {
    try {
      raw = decodeURIComponent(new URL(raw).pathname);
    } catch {
      return null;
    }
  }
  raw = raw.replace(/^`|`$/g, "").replace(/:\d+(?::\d+)?$/, "");
  if (!raw || raw.includes("\0")) return null;
  if (cwd && raw.startsWith(`${cwd.replace(/\/+$/, "")}/`)) {
    return raw.slice(cwd.replace(/\/+$/, "").length + 1);
  }
  if (raw.startsWith("./")) return raw.slice(2);
  if (!raw.startsWith("/") && !raw.startsWith("../")) return raw;
  return null;
}
