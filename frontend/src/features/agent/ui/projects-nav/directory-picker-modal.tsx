"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button, ErrorBox } from "@/ui";
import { Folder } from "@/ui/icons";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useProjectDirectoryPickerModalEffects } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import type { DirectoryBrowserEntry, DirectoryBrowserPayload } from "./types";

export function ProjectDirectoryPickerModal({
  open,
  error,
  onClose,
  onSelect,
  anchorRef,
}: {
  open: boolean;
  error: string;
  onClose: () => void;
  onSelect: (path: string) => void;
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [homePath, setHomePath] = useState("");
  const [entries, setEntries] = useState<DirectoryBrowserEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 16, left: 16 });
  const [present, setPresent] = useState(open);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const loadDirectory = useCallback(async (directoryPath?: string) => {
    setLoading(true);
    setBrowseError("");
    try {
      const query = directoryPath ? `?path=${encodeURIComponent(directoryPath)}` : "";
      const response = await fetch(`/api/agent/directories${query}`, { cache: "no-store" });
      const payload = (await response.json()) as DirectoryBrowserPayload;
      if (!response.ok) throw new Error(payload.error || "Failed to list directories");
      setCurrentPath(payload.path);
      setDraftPath(payload.path);
      setParentPath(payload.parent);
      setHomePath(payload.home);
      setEntries((payload.entries ?? []).filter((entry) => !entry.name.startsWith(".")));
      setActiveIndex(0);
    } catch (loadError) {
      setBrowseError(loadError instanceof Error ? loadError.message : "Failed to list directories");
    } finally {
      setLoading(false);
    }
  }, []);

  useProjectDirectoryPickerModalEffects({ loadDirectory, open });

  useMountSubscription(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timeout = window.setTimeout(() => setPresent(false), 90);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useMountSubscription(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = anchorRef?.current;
      if (!anchor) {
        setPosition({ top: 16, left: 16 });
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(420, window.innerWidth - 24);
      setPosition({
        top: Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 560)),
        left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12)),
      });
    };
    updatePosition();
    pathInputRef.current?.focus();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, open]);

  const goToDraftPath = () => {
    const next = draftPath.trim();
    if (next) void loadDirectory(next);
  };

  if (!present) return null;

  const closeAndFocus = () => {
    onClose();
    requestAnimationFrame(() => anchorRef?.current?.focus());
  };

  const setActive = (nextIndex: number) => {
    setActiveIndex(nextIndex);
    queueMicrotask(() => rowRefs.current[nextIndex]?.scrollIntoView({ block: "nearest" }));
  };

  const moveActive = (delta: number) => {
    if (entries.length === 0) return;
    setActive((activeIndex + delta + entries.length) % entries.length);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Home" && event.target !== pathInputRef.current) {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End" && event.target !== pathInputRef.current) {
      event.preventDefault();
      setActive(Math.max(0, entries.length - 1));
      return;
    }
    if (event.key === "Enter" && event.target !== pathInputRef.current) {
      const entry = entries[activeIndex];
      if (entry) {
        event.preventDefault();
        void loadDirectory(entry.path);
      }
    }
  };

  const picker = (
    <>
      <button
        type="button"
        aria-label="Close project picker"
        className={`fixed inset-0 z-[1000] cursor-default bg-transparent ${open ? "" : "pointer-events-none"}`}
        onClick={closeAndFocus}
      />
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="project-picker-title"
        aria-hidden={!open}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{ top: position.top, left: position.left }}
        className={`fixed z-[1010] flex max-h-[min(560px,calc(100vh-24px))] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden outline-none ${open ? "ui-popover-enter" : "ui-popover-exit pointer-events-none"} ${POPOVER_SURFACE_CLASS}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-(--separator) px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Folder className="h-4 w-4 shrink-0 text-(--dim)" />
            <h2 id="project-picker-title" className="truncate text-sm font-semibold text-(--fg)">
              Add project folder
            </h2>
          </div>
          <button
            type="button"
            onClick={closeAndFocus}
            className="flex h-6 w-6 items-center justify-center rounded text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="space-y-2.5 p-3 text-[length:var(--fs-base)] text-(--fg)">
          <p className="text-xs leading-4 text-(--dim)">
            Browse folders on this machine, or paste an absolute path.
          </p>
          <div className="flex gap-2">
            <input
              ref={pathInputRef}
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") goToDraftPath();
              }}
              className="min-w-0 flex-1 rounded-lg border border-(--border) bg-(--color-input) px-3 py-2 font-mono text-xs text-(--fg) outline-none focus:border-(--accent)"
              placeholder="/Users/name/project"
              aria-label="Directory path"
            />
            <Button
              variant="secondary"
              onClick={goToDraftPath}
              disabled={loading || !draftPath.trim()}
            >
              Go
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => homePath && void loadDirectory(homePath)}
              disabled={!homePath || loading}
            >
              Home
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => parentPath && void loadDirectory(parentPath)}
              disabled={!parentPath || loading}
            >
              Up
            </Button>
            <span className="min-w-0 truncate font-mono text-xs text-(--dim)" title={currentPath}>
              {currentPath || "Loading..."}
            </span>
          </div>
          <div
            role="listbox"
            aria-label="Folders"
            className="h-56 overflow-auto rounded-lg border border-(--border) bg-(--color-background) p-1"
          >
            {loading ? (
              <div className="px-3 py-8 text-center text-xs text-(--dim)">Loading folders...</div>
            ) : entries.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-(--dim)">No subfolders found.</div>
            ) : (
              entries.map((entry, index) => (
                <button
                  key={entry.path}
                  type="button"
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => void loadDirectory(entry.path)}
                  onPointerEnter={() => setActiveIndex(index)}
                  className={
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs " +
                    (index === activeIndex
                      ? "bg-(--color-menu-hover) text-(--fg)"
                      : "text-(--dim) hover:bg-(--color-menu-hover) hover:text-(--fg)")
                  }
                  title={entry.path}
                >
                  <Folder className="h-4 w-4 shrink-0 text-(--dim)" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))
            )}
          </div>
          {(browseError || error) && <ErrorBox>{browseError || error}</ErrorBox>}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-(--separator) px-3 py-2.5">
          <span className="text-[10px] text-(--dim)">↑↓ move · Enter open · Esc cancel</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={closeAndFocus}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const selectedPath = draftPath.trim() || currentPath;
                if (selectedPath) onSelect(selectedPath);
              }}
              disabled={!(draftPath.trim() || currentPath) || loading}
            >
              Select folder
            </Button>
          </div>
        </div>
      </div>
    </>
  );

  return typeof document === "undefined" ? null : createPortal(picker, document.body);
}
