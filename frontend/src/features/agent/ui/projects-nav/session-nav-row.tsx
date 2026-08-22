"use client";

import Link from "next/link";
import { MenuItem } from "@/ui";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import { Archive, MoreIcon, PinIcon, PinOffIcon, SquarePen, X } from "@/ui/icon-registry";
import type { SessionActivity } from "@/features/agent/session-index";
import type { SessionPref } from "@/features/agent/messages/session-prefs";
import { hrefWithOpenNonce, visibleSessionAge } from "./helpers";
import { PinButton, SessionStatusMark } from "./nav-chrome";

// One padding for every section — pinned rows used to reserve pr-8 for an
// always-visible pin that no longer renders at rest, which pushed their dates
// to a different column than task rows.
const OPEN_TARGET_CLASS =
  "flex min-w-0 flex-1 items-center gap-1 pr-2 group-hover:pr-[52px] group-has-[:focus-visible]:pr-[52px]";

const SESSION_MENU_CLASS = `absolute right-0 top-6 isolate z-[999] min-w-[180px] ${POPOVER_MENU_CLASS}`;

type SessionNavRowProps = {
  pref: SessionPref;
  label: string;
  initialDraft: string;
  rowClass: string;
  renameRowClass?: string;
  href?: string;
  onOpen?: (href: string) => void;
  onPatchPref: (patch: SessionPref) => void;
  onArchive?: () => void;
  onRenameCommit?: (title: string) => void;
  onRememberTitle?: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent) => void;
  onDrop?: (event: DragEvent) => void;
  onContextMenu?: boolean;
  activity?: SessionActivity;
  timestamp?: string | null;
  canDoubleClickRename?: boolean;
  showClearAction?: boolean;
  renameInputClass?: string;
};

export function SessionNavRow({
  pref,
  label,
  initialDraft,
  rowClass,
  renameRowClass = rowClass,
  href,
  onOpen,
  onPatchPref,
  onArchive,
  onRenameCommit,
  onRememberTitle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu = false,
  activity = "idle",
  timestamp,
  canDoubleClickRename = false,
  showClearAction = false,
  renameInputClass = "text-[length:var(--fs-md)]",
}: SessionNavRowProps) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));
  const startRename = () => {
    setDraft(initialDraft);
    setRenaming(true);
  };
  const finishRename = () => {
    const trimmed = draft.trim();
    onPatchPref({ title: trimmed || undefined });
    onRenameCommit?.(trimmed);
    setRenaming(false);
  };
  const openProps = canDoubleClickRename
    ? {
        onDoubleClick: (event: MouseEvent) => {
          event.preventDefault();
          startRename();
        },
      }
    : {};
  const age = visibleSessionAge(activity === "running", timestamp, activity === "finished");
  const rowContent = (
    <>
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[length:var(--fs-md)] font-normal leading-5 [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
        {label}
      </span>
      <SessionStatusMark
        activity={activity}
        runningClass="ml-auto flex w-8 shrink-0 justify-end"
        dotClass="h-1.5 w-1.5 shrink-0 rounded-full"
      />
      {age ? (
        <span className="shrink-0 pl-3 text-[length:var(--fs-sm)] tabular-nums text-(--hl2) transition-opacity duration-150 group-hover:opacity-0">
          {age}
        </span>
      ) : null}
    </>
  );
  const handleContextMenu = onContextMenu
    ? (event: MouseEvent) => {
        event.preventDefault();
        setMenuOpen(true);
      }
    : undefined;

  if (renaming) {
    return (
      <div className={renameRowClass}>
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename();
            if (event.key === "Escape") {
              setDraft(initialDraft);
              setRenaming(false);
            }
          }}
          className={`min-w-0 flex-1 bg-transparent ${renameInputClass} text-(--fg) outline-none`}
        />
      </div>
    );
  }

  return (
    <div
      className={`${rowClass} ${menuOpen ? "z-[900]" : "z-0"}`}
      onContextMenu={handleContextMenu}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {href ? (
        <Link
          href={href}
          aria-label={label}
          draggable
          onClick={(event) => {
            onRememberTitle?.();
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            const targetHref = hrefWithOpenNonce(href);
            onOpen?.(targetHref);
            router.push(targetHref);
          }}
          onDragStart={onDragStart}
          className={OPEN_TARGET_CLASS}
          {...openProps}
        >
          {rowContent}
        </Link>
      ) : (
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onClick={() => {
            onRememberTitle?.();
            onOpen?.("");
          }}
          aria-label={label}
          className={`${OPEN_TARGET_CLASS} text-left`}
          {...openProps}
        >
          {rowContent}
        </button>
      )}
      <div
        ref={menuRef}
        // Hidden as a WHOLE at rest: with per-button hiding only, the empty
        // container still painted its inherited background — on the focused
        // row that rendered a blank pill on top of the spinner and date.
        className={`absolute right-1 top-1/2 z-20 flex -translate-y-1/2 shrink-0 items-center gap-0.5 rounded-md bg-[inherit] transition-opacity duration-150 ${
          menuOpen
            ? "opacity-100"
            : "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        }`}
      >
        <PinButton
          pinned={Boolean(pref.pinned)}
          onToggle={() => onPatchPref({ pinned: !pref.pinned })}
          target="session"
        />
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-(--dim) transition-[opacity,color,background-color] hover:bg-(--hover) hover:text-(--fg) ${
            menuOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          }`}
          aria-label="Session options"
          title="Session options"
        >
          <MoreIcon className="pointer-events-none h-3.5 w-3.5" />
        </button>
        {menuOpen ? (
          <SessionOptionsMenu
            onArchive={onArchive}
            onClear={() => onPatchPref({ title: undefined, pinned: undefined })}
            onClose={() => setMenuOpen(false)}
            onPin={() => onPatchPref({ pinned: !pref.pinned })}
            onRename={startRename}
            pref={pref}
            showClearAction={showClearAction}
          />
        ) : null}
      </div>
    </div>
  );
}

function SessionOptionsMenu({
  onArchive,
  onClear,
  onClose,
  onPin,
  onRename,
  pref,
  showClearAction,
}: {
  onArchive?: () => void;
  onClear: () => void;
  onClose: () => void;
  onPin: () => void;
  onRename: () => void;
  pref: SessionPref;
  showClearAction: boolean;
}) {
  const showClear = showClearAction && (pref.title || pref.pinned);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div className={SESSION_MENU_CLASS} role="menu">
      <MenuItem Icon={pref.pinned ? PinOffIcon : PinIcon} onClick={run(onPin)}>
        {pref.pinned ? "Unpin" : "Pin"}
      </MenuItem>
      <MenuItem Icon={SquarePen} onClick={run(onRename)}>
        Rename
      </MenuItem>
      {onArchive ? (
        <MenuItem Icon={Archive} onClick={run(onArchive)}>
          Archive
        </MenuItem>
      ) : null}
      {showClear ? (
        <>
          <div className="mx-1 my-1 h-px bg-(--border)" />
          <MenuItem Icon={X} danger onClick={run(onClear)}>
            Clear
          </MenuItem>
        </>
      ) : null}
    </div>
  );
}
