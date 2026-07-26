"use client";

import type { ReactNode } from "react";
import { Pin } from "@/ui/icon-registry";
import { ChevronDownIcon } from "@/ui/icons";

/** The one pin control for every sidebar row (sessions and projects).
 *  "rail" hangs the button on the vertical guide line left of the row —
 *  left-[-12px] centers a 16px hit target on the rail's border, which sits 4px
 *  (the rail's pl-1) outside the row's box. "inline" sits in the row's hover
 *  action cluster, for rows that are not inside a rail. */
export function PinButton({
  pinned,
  onToggle,
  target,
  placement,
}: {
  pinned: boolean;
  onToggle: () => void;
  target: string;
  placement: "rail" | "inline";
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      aria-label={pinned ? `Unpin ${target}` : `Pin ${target}`}
      title={pinned ? "Unpin" : "Pin"}
      className={`inline-flex items-center justify-center rounded-[var(--rad-xs)] transition-[opacity,color] hover:text-(--fg) ${
        placement === "rail"
          ? "absolute left-[-12px] top-1/2 z-20 h-4 w-4 -translate-y-1/2 bg-(--sidebar-bg)"
          : "h-5 w-5"
      } ${
        pinned
          ? "text-(--fg)/75 opacity-100"
          : "text-(--dim)/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
      }`}
    >
      <Pin className="pointer-events-none h-3 w-3" fill={pinned ? "currentColor" : "none"} />
    </button>
  );
}

/** Indented column with the vertical guide line that session rows live in.
 *  Pinned, project and task rows all share it so the three read identically. */
export function SidebarRail({ children }: { children: ReactNode }) {
  return <div className="ml-[17px] flex flex-col border-l border-(--border) pl-1">{children}</div>;
}

export function SidebarSectionHeader({
  label,
  open,
  onToggle,
  action,
  indicator = false,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  indicator?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      className="group flex cursor-default items-center justify-between px-2 pb-1 pt-5 text-[length:var(--fs-sm)] font-normal text-(--hl2)"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 text-left hover:text-(--fg) focus-visible:text-(--fg) focus-visible:outline-none"
        aria-expanded={open}
      >
        <span>{label}</span>
        {!open && indicator ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--link)"
            aria-label={`${label} has unseen activity`}
            title={`${label} has unseen activity`}
          />
        ) : null}
        <ChevronDownIcon
          className={`h-2.5 w-2.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-within:opacity-100 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {action ? (
        <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {action}
        </div>
      ) : null}
    </div>
  );
}
