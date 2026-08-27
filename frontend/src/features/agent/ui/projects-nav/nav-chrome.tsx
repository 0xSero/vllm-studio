"use client";

import type { ReactNode } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { SessionActivity } from "@/features/agent/session-index";
import { Spinner } from "@/ui";
import { PinIcon } from "@/ui/icon-registry";
import { ChevronDownIcon } from "@/ui/icons";

/** The trailing status mark every session row shows: spinner while running,
 *  green dot when a run finished, accent dot for unseen activity. Layout
 *  differs per host — the project tree reserves a w-8 spinner column and lets
 *  its flex-1 label push the dots right, the recents list right-aligns each
 *  mark itself — so the wrapper classes come from the caller. */
export function SessionStatusMark({
  activity,
  runningClass,
  dotClass,
}: {
  activity: SessionActivity;
  runningClass: string;
  dotClass: string;
}) {
  if (activity === "running") {
    return (
      <span className={runningClass} aria-label="Session running">
        <Spinner size="xs" className="text-(--link)" />
      </span>
    );
  }
  if (activity === "finished") {
    return (
      <span className={`${dotClass} bg-(--ok)`} aria-label="Run finished" title="Run finished" />
    );
  }
  if (activity === "unseen") {
    return (
      <span
        className={`${dotClass} bg-(--link)`}
        aria-label="Unseen activity"
        title="Unseen activity"
      />
    );
  }
  return null;
}

export function PinButton({
  pinned,
  onToggle,
  target,
}: {
  pinned: boolean;
  onToggle: () => void;
  target: string;
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
      className={`inline-flex h-5 w-5 items-center justify-center transition-[opacity,color] duration-[var(--motion-fast)] hover:text-white ${
        pinned
          ? "text-(--fg)/85 opacity-90"
          : "pointer-events-none opacity-0 text-(--dim)/70 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
      }`}
    >
      <PinIcon className="pointer-events-none h-3 w-3" />
    </button>
  );
}

export function SidebarRail({
  children,
  animate = true,
  className = "",
}: {
  children: ReactNode;
  animate?: boolean;
  className?: string;
}) {
  const [animationRef] = useAutoAnimate<HTMLDivElement>({ duration: 150, easing: "ease-out" });
  return (
    <div ref={animate ? animationRef : undefined} className={`flex flex-col ${className}`}>
      {children}
    </div>
  );
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
      className="group flex cursor-default items-center justify-between pe-1 ps-2 pb-1 pt-3 text-[length:var(--fs-sm)] font-medium text-(--hl2) opacity-75 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100"
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
          className={`h-2.5 w-2.5 shrink-0 opacity-0 transition-[opacity,transform] duration-[var(--motion-fast)] group-hover:opacity-100 group-focus-within:opacity-100 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {action ? (
        <div className="opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 group-focus-within:opacity-100">
          {action}
        </div>
      ) : null}
    </div>
  );
}
