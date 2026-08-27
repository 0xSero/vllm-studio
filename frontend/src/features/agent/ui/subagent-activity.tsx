"use client";

import { Effect, Schema } from "effect";
import { useState } from "react";
import { openWorkbenchResource } from "@/features/workbench/controller-state";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const SubagentRunSchema = Schema.Struct({
  id: Schema.String,
  runtimeSessionId: Schema.String,
  name: Schema.String,
  task: Schema.String,
  piSessionId: Schema.NullOr(Schema.String),
  status: Schema.Union([
    Schema.Literal("running"),
    Schema.Literal("done"),
    Schema.Literal("error"),
    Schema.Literal("cancelled"),
  ]),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  modelId: Schema.optional(Schema.NullOr(Schema.String)),
  modelRouteId: Schema.optional(Schema.NullOr(Schema.String)),
  harness: Schema.optional(Schema.NullOr(Schema.String)),
  usageTotal: Schema.optional(Schema.Number),
});

const SubagentPayloadSchema = Schema.Struct({
  subagents: Schema.Array(SubagentRunSchema),
});

const decodeSubagentPayload = Schema.decodeUnknownOption(SubagentPayloadSchema, {
  onExcessProperty: "preserve",
});

export type SubagentRun = typeof SubagentRunSchema.Type;

export const SUBAGENT_RESOURCE_PREFIX = "subagent/";

export function subagentResourceId(piSessionId: string): string {
  return `${SUBAGENT_RESOURCE_PREFIX}${encodeURIComponent(piSessionId)}`;
}

export function sessionIdFromSubagentResource(resourceId: string | undefined): string | null {
  if (!resourceId?.startsWith(SUBAGENT_RESOURCE_PREFIX)) return null;
  try {
    return decodeURIComponent(resourceId.slice(SUBAGENT_RESOURCE_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

function fetchSubagents(parentPiSessionId: string): Effect.Effect<SubagentRun[], never> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        `/api/agent/subagents?piSessionId=${encodeURIComponent(parentPiSessionId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return [];
      const decoded = decodeSubagentPayload(await response.json());
      return decoded._tag === "Some" ? [...decoded.value.subagents] : [];
    },
    catch: () => [],
  }).pipe(Effect.catch(() => Effect.succeed([])));
}

export function useSubagentRuns(parentPiSessionId: string | null): SubagentRun[] {
  const [runs, setRuns] = useState<SubagentRun[]>([]);
  useMountSubscription(() => {
    if (!parentPiSessionId) {
      setRuns([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      Effect.runPromise(fetchSubagents(parentPiSessionId)).then((next) => {
        if (!cancelled) setRuns(next);
      });
    void load();
    const timer = window.setInterval(() => void load(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [parentPiSessionId]);
  return runs;
}

function durationLabel(run: SubagentRun): string | null {
  const started = Date.parse(run.startedAt);
  const finished = Date.parse(run.finishedAt ?? "");
  const elapsed = Number.isFinite(finished) ? finished - started : Date.now() - started;
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  if (elapsed < 1_000) return `${Math.round(elapsed)}ms`;
  return `${(elapsed / 1_000).toFixed(elapsed < 10_000 ? 1 : 0)}s`;
}

export function SubagentActivityRows({ runs }: { runs: readonly SubagentRun[] }) {
  if (runs.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
      {runs.map((run) => {
        const duration = durationLabel(run);
        const metadata = [run.modelId, run.harness].filter(Boolean).join(" · ");
        return (
          <button
            key={run.id}
            type="button"
            onClick={() => {
              openWorkbenchResource({
                kind: "chat",
                resourceId: subagentResourceId(run.runtimeSessionId),
                title: run.name,
              });
            }}
            className="group flex min-w-0 items-start gap-3 px-1 py-1.5 text-left disabled:cursor-default"
          >
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[length:var(--fs-sm)] text-(--fg)/88 transition-colors group-hover:text-(--fg)">
                  {run.name}
                </span>
                {metadata ? (
                  <span className="shrink-0 text-[length:var(--fs-xs)] text-(--dim)/70">
                    {metadata}
                  </span>
                ) : null}
              </span>
              <span className="block truncate pt-0.5 text-[length:var(--fs-xs)] text-(--dim)/75">
                {run.status === "error" ? run.error || "Subagent failed" : run.task}
              </span>
            </span>
            {duration ? (
              <span className="shrink-0 pt-0.5 font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/70">
                {duration}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
