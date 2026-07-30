"use client";

import type { ReactNode } from "react";
import { Check, Circle, LoaderCircle } from "@/ui/icon-registry";
import { Button } from "@/ui";
import { BRAND_PROFILE } from "@/lib/brand-profile";
import { ApplianceBrandMark } from "@/features/shell/appliance-brand-mark";
import type { CommissioningEvidence } from "../commissioning-readiness";

export interface SetupSurface {
  readonly eyebrow: string;
  readonly shortTitle: string;
  readonly title: string;
  readonly sub?: string;
}

export function SetupShell({
  surfaceIndex,
  surfaceCount,
  surfaces,
  surface,
  onSkip,
  onSurfaceSelect,
  evidence,
  evidenceLoading = false,
  evidenceError,
  children,
}: {
  surfaceIndex: number;
  surfaceCount: number;
  surfaces: readonly SetupSurface[];
  surface: SetupSurface;
  onSkip: () => void;
  onSurfaceSelect?: (index: number) => void;
  evidence?: readonly CommissioningEvidence[];
  evidenceLoading?: boolean;
  evidenceError?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-(--ui-bg) text-(--ui-fg) [&_button]:rounded-[var(--rad-sm)]">
      <a
        href="#setup-content"
        className="sr-only z-50 bg-(--ui-bg) px-3 py-2 text-(--ui-fg) focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to setup
      </a>

      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-(--ui-border) bg-(--ui-surface) px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="w-36 shrink-0 sm:w-44">
            <ApplianceBrandMark />
          </div>
          <div className="hidden h-7 w-px bg-(--ui-separator) sm:block" aria-hidden="true" />
          <div className="hidden min-w-0 sm:block">
            <div className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.16em] text-(--ui-muted)">
              Workstation commissioning
            </div>
            <div className="truncate text-[length:var(--fs-sm)] text-(--ui-fg)">
              Establish access, execution, and serving
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkip}
          className="min-h-11 rounded-[var(--rad-sm)] px-3"
        >
          Exit without completing
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[252px_minmax(0,1fr)] xl:grid-cols-[252px_minmax(0,1fr)_288px]">
        <nav
          aria-label="Setup stages"
          className="border-b border-(--ui-border) bg-(--sidebar-bg) px-4 py-4 text-(--sidebar-fg) lg:border-b-0 lg:border-r lg:px-5 lg:py-6"
        >
          <div className="mb-3 flex items-center justify-between lg:mb-5">
            <span className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.16em] text-(--hl2)">
              Commissioning tracks
            </span>
            <span className="font-mono text-[length:var(--fs-xs)] text-(--sidebar-fg)">
              {surfaceIndex + 1}/{surfaceCount}
            </span>
          </div>
          <ol className="grid grid-cols-2 gap-1 sm:grid-cols-5 lg:grid-cols-1 lg:gap-2">
            {surfaces.map((item, index) => {
              const state = index === surfaceIndex ? "active" : "pending";
              return (
                <li key={item.shortTitle}>
                  <button
                    type="button"
                    onClick={() => onSurfaceSelect?.(index)}
                    aria-current={state === "active" ? "step" : undefined}
                    className={`grid min-h-11 w-full grid-cols-[20px_minmax(0,1fr)] items-center gap-2 border px-2.5 py-2 text-left ${
                      state === "active"
                        ? "border-(--sidebar-border) bg-(--sidebar-hover) text-(--sidebar-fg)"
                        : "border-transparent text-(--hl2) hover:border-(--sidebar-border) hover:text-(--sidebar-fg)"
                    }`}
                  >
                    <SetupStageIcon state={state} />
                    <span className="min-w-0">
                      <span className="block truncate text-[length:var(--fs-sm)] font-medium">
                        {item.shortTitle}
                      </span>
                      <span className="hidden truncate font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.1em] lg:block">
                        {state === "active" ? "selected" : "available"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-6 hidden border-t border-(--sidebar-border) pt-5 lg:block">
            <div className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.14em] text-(--hl2)">
              Deployment
            </div>
            <div className="mt-2 text-[length:var(--fs-sm)] text-(--sidebar-fg)">
              Local controller
            </div>
            <div className="mt-1 font-mono text-[length:var(--fs-xs)] text-(--hl2)">
              127.0.0.1:8080
            </div>
          </div>
        </nav>

        <section
          id="setup-content"
          tabIndex={-1}
          aria-labelledby="setup-title"
          className="min-h-0 overflow-y-auto bg-(--ui-bg)"
        >
          <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-8 sm:py-9 lg:px-10 lg:py-12">
            <div className="mb-7 border-b border-(--ui-separator) pb-6">
              <div className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--ui-muted)">
                {surface.eyebrow}
              </div>
              <h1
                id="setup-title"
                className="mt-2 max-w-3xl text-[length:var(--fs-4xl)] font-medium tracking-[-0.025em] text-(--ui-fg)"
              >
                {surface.title}
              </h1>
              {surface.sub ? (
                <p className="mt-2 max-w-2xl text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
                  {surface.sub}
                </p>
              ) : null}
            </div>
            {children}
          </div>
        </section>

        <aside
          aria-label="Setup evidence"
          className="hidden min-h-0 overflow-y-auto border-l border-(--ui-border) bg-(--ui-surface) px-5 py-7 xl:block"
        >
          <div className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.16em] text-(--ui-muted)">
            Evidence margin
          </div>
          <h2 className="mt-2 text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">
            Current standing
          </h2>
          <div className="mt-5 divide-y divide-(--ui-separator)">
            <SetupEvidence
              label="Appliance profile"
              value={BRAND_PROFILE.appName}
              claim="observed"
            />
            <SetupEvidence
              label="Commissioning stage"
              value={`${surfaceIndex + 1} of ${surfaceCount} · active`}
              claim="observed"
            />
            {evidenceLoading && !evidence?.length ? (
              <SetupEvidence
                label="Readiness ledger"
                value="Inspecting live state"
                claim="claimed"
              />
            ) : null}
            {evidenceError ? (
              <SetupEvidence label="Readiness ledger" value={evidenceError} claim="contradicted" />
            ) : null}
            {(evidence ?? []).map((entry) => (
              <SetupEvidence
                key={entry.id}
                label={entry.label}
                value={entry.detail}
                claim={entry.state}
              />
            ))}
          </div>
          <p className="mt-6 border-t border-(--ui-separator) pt-5 text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
            Setup reports controller state without upgrading claims. Receipt digests are observed
            records; cryptographic attestation is not claimed.
          </p>
        </aside>
      </div>
    </div>
  );
}

function SetupStageIcon({ state }: { state: "active" | "pending" }) {
  if (state === "active") return <LoaderCircle className="h-4 w-4" aria-hidden="true" />;
  return <Circle className="h-4 w-4" aria-hidden="true" />;
}

const claimLabel = {
  observed: "⊢ observed",
  claimed: "○ claimed",
  attested: "◆ attested",
  contradicted: "⊭ contradicted",
} as const;

function SetupEvidence({
  label,
  value,
  claim,
}: {
  label: string;
  value: string;
  claim: CommissioningEvidence["state"];
}) {
  return (
    <div className="py-4 first:pt-0">
      <div className="flex items-center justify-between gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
        <span>{label}</span>
        <span className={claim === "attested" ? "text-(--proof)" : undefined}>
          {claimLabel[claim]}
        </span>
      </div>
      <div className="mt-1 break-words font-mono text-[length:var(--fs-sm)] text-(--ui-fg)">
        {value}
      </div>
    </div>
  );
}

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
  meta?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={`border bg-(--ui-surface) ${
        state === "active" ? "border-(--ui-border)" : "border-(--ui-separator)"
      }`}
    >
      <div className="flex min-h-12 items-center gap-3 px-4 py-3">
        <ChecklistMark state={state} />
        <span
          className={`min-w-0 flex-1 truncate text-[length:var(--fs-md)] ${
            state === "pending" ? "text-(--ui-muted)" : "text-(--ui-fg)"
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
        <div className="border-t border-(--ui-separator) bg-(--ui-surface-2) px-4 py-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ChecklistMark({ state }: { state: ChecklistState }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center border border-(--ui-border) text-(--ui-fg)">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center border border-(--ui-border) text-(--ui-fg)">
        <LoaderCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  return <span className="h-5 w-5 shrink-0 border border-(--ui-separator)" aria-hidden="true" />;
}
