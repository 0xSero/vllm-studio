"use client";

// The session's subagents, as a vertical list of rows in the conversation
// column (not badge pills). Each row is one child agent this session spawned,
// with a live status; clicking a row opens that child's session in the right
// panel's side-chat pane, so drilling into a subagent never tears down the
// workspace the parent is running in.

import { useState } from "react";
import { ChevronRight, Bot } from "@/ui/icon-registry";
import { Spinner } from "@/ui";
import { useToolsActions } from "@/features/agent/tools/context";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type SubagentRun = {
  id: string;
  name: string;
  piSessionId: string | null;
  status: "running" | "done" | "error" | "cancelled";
  /** False while "running" means the child is registered but not streaming. */
  active?: boolean;
  startedAt: string;
  finishedAt: string | null;
  error?: string;
};

const statusDot: Record<SubagentRun["status"], string> = {
  running: "bg-(--ok,#40c977)",
  done: "bg-(--ok,#40c977)",
  error: "bg-(--err)",
  cancelled: "bg-(--fg)/30",
};

function statusLabel(run: SubagentRun): string {
  if (run.status === "running") return run.active === false ? "running · idle" : "working";
  if (run.status === "done") return "updated";
  if (run.status === "cancelled") return "stopped";
  return "failed";
}

async function fetchSubagents(parentPiSessionId: string): Promise<SubagentRun[]> {
  const response = await fetch(
    `/api/agent/subagents?piSessionId=${encodeURIComponent(parentPiSessionId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as { subagents?: SubagentRun[] };
  return Array.isArray(payload.subagents) ? payload.subagents : [];
}

export function SubagentList({
  piSessionId,
  cwd,
}: {
  piSessionId: string;
  /** The parent's working directory — children run in the same one, and the
   *  right-panel replay needs it to find the child's session log. */
  cwd: string | null;
}) {
  const { requestSessionPreview } = useToolsActions();
  const [runs, setRuns] = useState<SubagentRun[]>([]);

  useMountSubscription(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchSubagents(piSessionId);
        if (!cancelled) setRuns(next);
      } catch {
        // Transient; next poll retries.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [piSessionId]);

  if (runs.length === 0) return null;

  return (
    // Rows only, no header and no container chrome: this sits in a column that
    // already stacks the drawer and the composer, each with its own surface —
    // one more captioned box was pure bulk.
    <div className="mx-auto mb-1 flex w-full max-w-[calc(var(--composer-w)*0.9)] flex-col sm:w-[90%]">
      {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            disabled={!run.piSessionId}
            onClick={() => {
              if (!run.piSessionId) return;
              requestSessionPreview({ piSessionId: run.piSessionId, title: run.name, cwd });
            }}
            title={
              run.status === "error"
                ? `${run.name} — failed: ${run.error ?? "unknown error"}`
                : `${run.name} — open in the side panel`
            }
            className="group flex h-7 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[length:var(--fs-sm)] text-(--fg)/70 transition-colors hover:bg-(--hover) hover:text-(--fg)/90 disabled:cursor-default disabled:opacity-60"
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-(--fg)/40" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{run.name}</span>
            {run.status === "running" && run.active !== false ? (
              <Spinner size="xs" />
            ) : (
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[run.status]}`} />
            )}
            <span className="shrink-0 text-[length:var(--fs-xs)] text-(--fg)/40">
              {statusLabel(run)}
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-(--fg)/25 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
}
