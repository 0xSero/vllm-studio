"use client";

// Codex-style subagent chips: each child agent this session spawned, with a
// live status dot; click to open the subagent's own session (drill-in).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/ui";
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

const chipDot: Record<SubagentRun["status"], string> = {
  running: "bg-(--ok,#40c977)",
  done: "bg-(--ok,#40c977)",
  error: "bg-(--err)",
  cancelled: "bg-(--fg)/30",
};

const chipHint: Record<SubagentRun["status"], string> = {
  running: "working",
  done: "open the subagent session",
  error: "failed",
  cancelled: "stopped — open the subagent session",
};

async function fetchSubagents(parentPiSessionId: string): Promise<SubagentRun[]> {
  const response = await fetch(
    `/api/agent/subagents?piSessionId=${encodeURIComponent(parentPiSessionId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as { subagents?: SubagentRun[] };
  return Array.isArray(payload.subagents) ? payload.subagents : [];
}

export function SubagentChips({
  piSessionId,
  projectId,
}: {
  piSessionId: string;
  projectId?: string | null;
}) {
  const router = useRouter();
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
    <div className="mx-auto mb-1.5 flex w-full max-w-[var(--composer-w)] flex-wrap items-center gap-1.5">
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          disabled={!run.piSessionId}
          onClick={() => {
            if (!run.piSessionId) return;
            // Same link shape as every other open-session affordance: without
            // the project param the workspace replays into a null project and
            // the child opens as a blank pane.
            const project = projectId ? `project=${encodeURIComponent(projectId)}&` : "";
            router.push(
              `/agent?${project}session=${encodeURIComponent(run.piSessionId)}&replace=1`,
            );
          }}
          title={
            run.status === "error"
              ? `${run.name} — failed: ${run.error ?? "unknown error"}`
              : run.status === "running" && run.active === false
                ? `${run.name} — running (idle)`
                : `${run.name} — ${chipHint[run.status]}`
          }
          className="flex items-center gap-1.5 rounded-full bg-(--fg)/[0.05] px-2.5 py-1 text-[length:var(--fs-sm)] text-(--fg)/75 transition-colors hover:bg-(--fg)/[0.08] hover:text-(--fg)/90 disabled:cursor-default"
        >
          {run.status === "running" ? (
            <Spinner size="xs" />
          ) : (
            <span className={`h-1.5 w-1.5 rounded-full ${chipDot[run.status]}`} />
          )}
          <span className="max-w-44 truncate">{run.name}</span>
          {run.status === "done" ? <span className="text-(--fg)/40">updated</span> : null}
          {run.status === "cancelled" ? <span className="text-(--fg)/40">stopped</span> : null}
        </button>
      ))}
    </div>
  );
}
