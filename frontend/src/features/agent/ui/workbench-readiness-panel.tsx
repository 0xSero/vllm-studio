"use client";

import { Button, Spinner } from "@/ui";
import type {
  WorkbenchReadiness,
  WorkbenchReadinessAction,
} from "@/features/agent/ui/workbench-readiness";

const ACTION_LABELS: Record<WorkbenchReadinessAction, string> = {
  retry: "Try again",
  settings: "Open settings",
  models: "Open Models",
  status: "View startup",
};

export function WorkbenchReadinessPanel({
  readiness,
  onAction,
}: {
  readiness: WorkbenchReadiness;
  onAction: (action: WorkbenchReadinessAction) => void;
}) {
  const primaryAction = readiness.primaryAction;
  const secondaryAction = readiness.secondaryAction;
  if (readiness.kind === "ready") {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
        data-workbench-readiness="ready"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-(--border) bg-(--fg)/[0.025] px-3 py-1.5 text-[length:var(--fs-sm)] text-(--dim)">
          <span className="h-2 w-2 rounded-full bg-(--ok)" />
          {readiness.title}
        </div>
        <p className="max-w-[24ch] text-[clamp(1.45rem,2.6vw,2.1rem)] font-semibold leading-[1.22] tracking-[-0.02em] text-(--fg)/90">
          A dream is something you build for yourself.
        </p>
        <p className="text-[length:var(--fs-xl)] text-(--dim)">Just talk to it.</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-4 text-center"
      data-workbench-readiness={readiness.kind}
      role="status"
    >
      <div className="w-full max-w-md rounded-3xl border border-(--border) bg-(--composer)/70 px-7 py-7 shadow-[var(--shadow-lg)] backdrop-blur-xl">
        <div className="mx-auto mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-(--fg)/5">
          {readiness.kind === "connecting" || readiness.kind === "starting" ? (
            <Spinner size="sm" />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-(--warn)" />
          )}
        </div>
        <h2 className="text-[length:var(--fs-xl)] font-semibold text-(--fg)">{readiness.title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[length:var(--fs-base)] leading-5 text-(--dim)">
          {readiness.detail}
        </p>
        {primaryAction ? (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" onClick={() => onAction(primaryAction)}>
              {ACTION_LABELS[primaryAction]}
            </Button>
            {secondaryAction ? (
              <Button size="sm" variant="secondary" onClick={() => onAction(secondaryAction)}>
                {ACTION_LABELS[secondaryAction]}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
