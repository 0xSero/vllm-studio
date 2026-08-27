"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { handleMenuKeyboard, MenuItem } from "@/ui";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type MouseEvent, type RefObject } from "react";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import { Archive, PinIcon, PinOffIcon, SquarePen, TrashIcon, X } from "@/ui/icon-registry";
import type { SessionActivity } from "@/features/agent/session-index";
import type { SessionPref } from "@/features/agent/messages/prefs";
import { hrefWithOpenNonce } from "./helpers";
import { PinButton, SessionStatusMark } from "./nav-chrome";

const SESSION_MENU_CLASS = `ui-popover-enter fixed isolate z-[999] min-w-[180px] ${POPOVER_MENU_CLASS}`;

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
  canDoubleClickRename?: boolean;
  showClearAction?: boolean;
  renameInputClass?: string;
  card?: boolean;
  secondaryLabel?: string;
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
  canDoubleClickRename = false,
  showClearAction = false,
  renameInputClass = "text-[length:var(--fs-md)]",
  card = false,
  secondaryLabel,
}: SessionNavRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
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
        event.stopPropagation();
        setMenuPosition({
          left: Math.min(event.clientX, window.innerWidth - 188),
          top: Math.min(event.clientY, window.innerHeight - 196),
        });
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
      <SessionOpenTarget
        canDoubleClickRename={canDoubleClickRename}
        href={href}
        activity={activity}
        pinned={Boolean(pref.pinned)}
        label={label}
        card={card}
        secondaryLabel={secondaryLabel}
        onDragStart={onDragStart}
        onOpen={onOpen}
        onRememberTitle={onRememberTitle}
        onStartRename={startRename}
      />
      <div className="absolute right-1 top-1/2 z-20 flex -translate-y-1/2 shrink-0 items-center gap-1">
        <PinButton
          pinned={Boolean(pref.pinned)}
          onToggle={() => onPatchPref({ pinned: !pref.pinned })}
          target="session"
        />
        {onArchive ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onArchive();
            }}
            className="pointer-events-none inline-flex h-5 w-5 items-center justify-center text-(--dim)/70 opacity-0 transition-[opacity,color] duration-[var(--motion-fast)] hover:text-white focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
            aria-label={`Delete ${label}`}
            title="Delete"
          >
            <TrashIcon className="pointer-events-none h-3 w-3" />
          </button>
        ) : null}
      </div>
      {menuOpen && typeof document !== "undefined"
        ? createPortal(
            <SessionOptionsMenu
              menuRef={menuRef}
              position={menuPosition}
              onArchive={onArchive}
              onClear={() => onPatchPref({ title: undefined, pinned: undefined })}
              onClose={() => setMenuOpen(false)}
              onPin={() => onPatchPref({ pinned: !pref.pinned })}
              onRename={startRename}
              pref={pref}
              showClearAction={showClearAction}
            />,
            document.body,
          )
        : null}
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
  activity,
  pinned,
  label,
  card,
  secondaryLabel,
  onDragStart,
  onOpen,
  onRememberTitle,
  onStartRename,
}: {
  canDoubleClickRename: boolean;
  href?: string;
  activity: SessionActivity;
  pinned: boolean;
  label: string;
  card: boolean;
  secondaryLabel?: string;
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
  const targetClass = card
    ? "flex min-w-0 flex-1 items-stretch py-1.5 pr-1"
    : "flex min-w-0 flex-1 items-center gap-1 pr-1";
  const content = (
    <SessionRowContent
      activity={activity}
      label={label}
      orbKey={href ?? label}
      card={card}
      secondaryLabel={secondaryLabel}
    />
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
          router.push(targetHref);
        }}
        onDragStart={onDragStart}
        className={targetClass}
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
      className={`${targetClass} text-left`}
      {...openProps}
    >
      {content}
    </button>
  );
}

function SessionRowContent({
  activity,
  label,
  orbKey,
  card,
  secondaryLabel,
}: {
  activity: SessionActivity;
  label: string;
  orbKey: string;
  card: boolean;
  secondaryLabel?: string;
}) {
  if (card) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {activity === "running" ? <ActiveChatOrb seed={orbKey} /> : null}
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <span className="truncate text-[length:var(--fs-md)] font-medium leading-4 text-(--fg)">
            {label}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[length:var(--fs-2xs)] leading-4 text-(--hl2)/75">
            {activity !== "running" ? (
              <SessionStatusMark
                activity={activity}
                runningClass="flex w-3 shrink-0 justify-start"
                dotClass="h-1.5 w-1.5 shrink-0 rounded-full"
              />
            ) : null}
            <span className="min-w-0 truncate">
              {sessionActivityLabel(activity, secondaryLabel)}
            </span>
          </span>
        </span>
      </span>
    );
  }
  return (
    <>
      {activity === "running" ? <ActiveChatOrb seed={orbKey} /> : null}
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[length:var(--fs-md)] font-normal leading-5 [mask-image:linear-gradient(to_right,black_calc(100%-10px),transparent)] group-hover:[mask-image:linear-gradient(to_right,black_calc(100%-44px),transparent_calc(100%-4px))]">
        {label}
      </span>
      {activity !== "running" ? (
        <SessionStatusMark
          activity={activity}
          runningClass="ml-auto flex w-8 shrink-0 justify-end"
          dotClass="h-1.5 w-1.5 shrink-0 rounded-full"
        />
      ) : null}
    </>
  );
}

const ORB_STATES: OrbState[] = [
  "working",
  "searching",
  "solving",
  "connecting",
  "weaving",
  "composing",
  "breathing",
  "shaping",
];

function ActiveChatOrb({ seed }: { seed: string }) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const state = ORB_STATES[hash % ORB_STATES.length] ?? "working";
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
      <ThinkingOrb state={state} size={20} className="block shrink-0" aria-hidden="true" />
    </span>
  );
}

function sessionActivityLabel(activity: SessionActivity, fallback?: string) {
  if (activity === "running") return "Working";
  if (activity === "finished") return "Completed";
  if (activity === "unseen") return "Unread activity";
  return fallback || "Ready";
}

function SessionOptionsMenu({
  menuRef,
  position,
  onArchive,
  onClear,
  onClose,
  onPin,
  onRename,
  pref,
  showClearAction,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  position: { left: number; top: number };
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
    <div
      ref={menuRef}
      className={SESSION_MENU_CLASS}
      style={position}
      role="menu"
      onKeyDown={(event) => handleMenuKeyboard(event, onClose)}
    >
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
