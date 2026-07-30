"use client";

import Link from "next/link";
import { MenuItem, Spinner } from "@/ui";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import { Archive, MoreIcon, PinIcon, PinOffIcon, SquarePen, X } from "@/ui/icon-registry";
import type { SessionPref } from "@/features/agent/messages/prefs";
import { hrefWithOpenNonce, navigateToSessionHref } from "./helpers";
import { PinButton } from "./nav-chrome";

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
  isRunning?: boolean;
  unseen?: boolean;
  finished?: boolean;
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
  isRunning = false,
  unseen = false,
  finished = false,
  canDoubleClickRename = false,
  showClearAction = false,
  renameInputClass = "text-[length:var(--fs-md)]",
}: SessionNavRowProps) {
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
  const handleContextMenu = onContextMenu
    ? (event: MouseEvent) => {
        event.preventDefault();
        setMenuOpen(true);
      }
    : undefined;

  if (renaming) {
    return (
      <RenameInput
        className={renameRowClass}
        draft={draft}
        inputClassName={renameInputClass}
        initialDraft={initialDraft}
        onCancel={() => {
          setDraft(initialDraft);
          setRenaming(false);
        }}
        onChange={setDraft}
        onCommit={finishRename}
      />
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
      <PinButton
        pinned={Boolean(pref.pinned)}
        onToggle={() => onPatchPref({ pinned: !pref.pinned })}
        target="session"
      />
      <SessionOpenTarget
        canDoubleClickRename={canDoubleClickRename}
        href={href}
        isRunning={isRunning}
        unseen={unseen}
        finished={finished}
        label={label}
        onDragStart={onDragStart}
        onOpen={onOpen}
        onRememberTitle={onRememberTitle}
        onStartRename={startRename}
      />
      <div
        ref={menuRef}
        className="absolute right-1 top-1/2 z-20 flex -translate-y-1/2 shrink-0 items-center gap-0.5"
      >
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

function RenameInput({
  className,
  draft,
  inputClassName,
  initialDraft,
  onCancel,
  onChange,
  onCommit,
}: {
  className: string;
  draft: string;
  inputClassName: string;
  initialDraft: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className={className}>
      <input
        autoFocus
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit();
          if (event.key === "Escape") {
            onChange(initialDraft);
            onCancel();
          }
        }}
        className={`min-w-0 flex-1 bg-transparent ${inputClassName} text-(--fg) outline-none`}
      />
    </div>
  );
}

function SessionOpenTarget({
  canDoubleClickRename,
  href,
  isRunning,
  unseen,
  finished,
  label,
  onDragStart,
  onOpen,
  onRememberTitle,
  onStartRename,
}: {
  canDoubleClickRename: boolean;
  href?: string;
  isRunning: boolean;
  unseen: boolean;
  finished: boolean;
  label: string;
  onDragStart: (event: DragEvent) => void;
  onOpen?: (href: string) => void;
  onRememberTitle?: () => void;
  onStartRename: () => void;
}) {
  const router = useRouter();
  const openProps = canDoubleClickRename
    ? {
        onDoubleClick: (event: MouseEvent) => {
          event.preventDefault();
          onStartRename();
        },
      }
    : {};
  const content = (
    <SessionRowContent isRunning={isRunning} unseen={unseen} finished={finished} label={label} />
  );

  if (href) {
    return (
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
          navigateToSessionHref(router, targetHref);
        }}
        onDragStart={onDragStart}
        className="flex min-w-0 flex-1 items-center gap-1 pr-2 group-hover:pr-8 group-has-[:focus-visible]:pr-8"
        {...openProps}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={() => {
        onRememberTitle?.();
        onOpen?.("");
      }}
      aria-label={label}
      className="flex min-w-0 flex-1 items-center gap-1 pr-2 text-left group-hover:pr-8 group-has-[:focus-visible]:pr-8"
      {...openProps}
    >
      {content}
    </button>
  );
}

function SessionRowContent({
  isRunning,
  unseen,
  finished,
  label,
}: {
  isRunning: boolean;
  unseen: boolean;
  finished: boolean;
  label: string;
}) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate text-[length:var(--fs-md)] font-normal leading-5">
        {label}
      </span>
      {isRunning ? (
        <Spinner
          size="xs"
          className="mr-1 shrink-0 text-(--link) transition-opacity group-hover:opacity-0"
        />
      ) : finished ? (
        <span
          className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-(--ok) transition-opacity group-hover:opacity-0"
          aria-label="Finished while away"
          title="Finished while away"
        />
      ) : unseen ? (
        <span
          className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-(--link) transition-opacity group-hover:opacity-0"
          aria-label="Unseen activity"
          title="Unseen activity"
        />
      ) : null}
      {/* No age column: the spinner and dots above carry the only status
          worth scanning for. */}
    </>
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
