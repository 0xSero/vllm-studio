"use client";

import { useRouter } from "next/navigation";
import { ChevronRight } from "@/ui/icon-registry";
import { Button, Card, StatusPill } from "@/ui";
import type { GPU, ProcessInfo, RecipeWithStatus } from "@/lib/types";
import type { RuntimeSummaryData, ServiceEntry } from "@/hooks/realtime-status-types";
import { commandCenterView, type CommandCenterPhase } from "./command-center-model";

export function CommandCenterOverview({
  connected,
  currentProcess,
  gpus,
  recipes,
  runtimeSummary,
  services,
}: {
  connected: boolean;
  currentProcess: ProcessInfo | null;
  gpus: GPU[];
  recipes: RecipeWithStatus[];
  runtimeSummary?: RuntimeSummaryData | null;
  services?: ServiceEntry[];
}) {
  const router = useRouter();
  const view = commandCenterView({
    connected,
    currentProcess,
    gpus,
    recipes,
    runtimeSummary,
    services,
  });

  return (
    <Card padding="lg" className="overflow-hidden border-(--ui-separator) bg-(--ui-surface)">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[length:var(--fs-2xs)] font-medium uppercase tracking-[0.2em] text-(--ui-muted)">
              {view.eyebrow}
            </span>
            <StatusPill tone={view.tone}>{view.statusLabel}</StatusPill>
          </div>
          <h1 className="mt-3 text-[length:var(--fs-4xl)] font-semibold tracking-[-0.025em] text-(--ui-fg)">
            {view.title}
          </h1>
          <p className="mt-2 max-w-2xl text-[length:var(--fs-base)] leading-6 text-(--ui-muted)">
            {view.description}
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => router.push(view.actionHref)}
          icon={<ChevronRight className="h-4 w-4" />}
          className="shrink-0"
        >
          {view.actionLabel}
        </Button>
      </div>

      <ol className="mt-8 grid overflow-hidden rounded-lg border border-(--ui-border) bg-(--ui-bg) sm:grid-cols-5">
        {view.phases.map((phase, index) => (
          <PipelinePhase key={phase.id} phase={phase} index={index} />
        ))}
      </ol>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-(--ui-border) lg:grid-cols-4">
        {view.facts.map((fact) => (
          <div key={fact.label} className="bg-(--ui-bg) px-4 py-3">
            <dt className="text-[length:var(--fs-xs)] text-(--ui-muted)">{fact.label}</dt>
            <dd className="mt-1 font-mono text-[length:var(--fs-xl)] tabular-nums text-(--ui-fg)">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function PipelinePhase({ phase, index }: { phase: CommandCenterPhase; index: number }) {
  const stateClass = {
    active: "border-(--ui-accent) bg-(--ui-accent)/10 text-(--ui-fg)",
    blocked: "border-(--ui-danger)/60 bg-(--ui-danger)/5 text-(--ui-muted)",
    complete: "border-(--ui-success)/60 bg-(--ui-success)/5 text-(--ui-fg)",
    pending: "border-transparent text-(--ui-muted)",
  }[phase.state];

  return (
    <li className={`border-b-2 px-4 py-3 sm:border-b-0 sm:border-t-2 ${stateClass}`}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[length:var(--fs-2xs)] tabular-nums opacity-60">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="text-[length:var(--fs-sm)] font-medium">{phase.label}</span>
      </div>
      <p className="mt-1 truncate text-[length:var(--fs-xs)] opacity-65" title={phase.detail}>
        {phase.detail}
      </p>
    </li>
  );
}
