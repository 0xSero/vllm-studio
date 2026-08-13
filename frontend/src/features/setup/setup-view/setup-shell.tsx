"use client";

import type { ReactNode } from "react";
import { Button } from "@/ui";

/**
 * The onboarding stage: one focal surface at a time, generous negative space, a ghost
 * glyph behind the content. Replaces the 18rem stepper rail + dense two-column layout —
 * progress is a quiet eyebrow ("STEP 1 OF 3") and three dots, nothing more.
 */

export interface SetupSurface {
  readonly eyebrow: string;
  readonly title: string;
  readonly sub?: string;
}

export function SetupShell({
  surfaceIndex,
  surfaceCount,
  surface,
  onSkip,
  children,
}: {
  surfaceIndex: number;
  surfaceCount: number;
  surface: SetupSurface;
  onSkip: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative h-screen overflow-y-auto bg-(--bg)">
      {/* Ghost glyph, Grok-style: enormous, barely-there. Fixed in its own clipping
          layer so it neither scrolls with the content nor blocks scrolling. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <span
          className="absolute -right-[10vw] -top-[22vh] select-none font-black leading-none tracking-tighter text-(--fg) opacity-[0.025]"
          style={{ fontSize: "70vh" }}
        >
          LS
        </span>
      </div>

      <div className="fixed right-5 top-5 z-10">
        <Button variant="secondary" size="sm" onClick={onSkip}>
          Skip for now
        </Button>
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-[640px] flex-col px-6 pb-16 pt-[14vh]">
        <div className="mb-2 flex items-center gap-3">
          <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">{surface.eyebrow}</span>
          <span className="flex items-center gap-1.5" aria-hidden>
            {Array.from({ length: surfaceCount }, (_, index) => (
              <span
                key={index}
                className={`h-1 w-1 rounded-full transition-colors ${
                  index <= surfaceIndex ? "bg-(--ui-accent)" : "bg-(--ui-border)"
                }`}
              />
            ))}
          </span>
        </div>
        <h1 className="text-[length:var(--fs-2xl)] font-medium tracking-tight text-(--fg)">
          {surface.title}
        </h1>
        {surface.sub ? (
          <p className="mt-1.5 text-[length:var(--fs-sm)] text-(--ui-muted)">{surface.sub}</p>
        ) : null}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

/* ── checklist primitives (the Grok "get you up and running" card) ────────── */

export type ChecklistState = "pending" | "active" | "done";

export function ChecklistRow({
  state,
  title,
  meta,
  action,
  children,
}: {
  state: ChecklistState;
  title: string;
  /** Right-aligned quiet detail shown when the row is not expanded. */
  meta?: ReactNode;
  /** Compact action shown in the row head while active. */
  action?: ReactNode;
  /** Expanded body, rendered only while active. */
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-[10px] border transition-colors ${
        state === "active"
          ? "border-(--ui-accent)/50 bg-(--ui-surface)/60"
          : "border-(--ui-border) bg-(--ui-surface)/25"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <ChecklistMark state={state} />
        <span
          className={`min-w-0 flex-1 truncate text-[length:var(--fs-md)] ${
            state === "pending" ? "text-(--ui-muted)" : "text-(--fg)"
          }`}
        >
          {title}
        </span>
        {state !== "active" && meta ? (
          <span className="shrink-0 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
            {meta}
          </span>
        ) : null}
        {state === "active" && action ? <span className="shrink-0">{action}</span> : null}
      </div>
      {state === "active" && children ? (
        <div className="border-t border-(--ui-border)/60 px-4 py-4">{children}</div>
      ) : null}
    </div>
  );
}

function ChecklistMark({ state }: { state: ChecklistState }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--ui-success) text-(--bg)">
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
          <path
            d="M2.5 6.5L5 9l4.5-6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={`h-5 w-5 shrink-0 rounded-full border-2 ${
        state === "active" ? "border-(--ui-accent)" : "border-(--ui-border)"
      }`}
    />
  );
}
