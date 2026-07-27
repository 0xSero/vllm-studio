"use client";

import { useCallback, useState, type ReactNode } from "react";
import { AppPage, Button, Card, ErrorBox, PageContainer, PageHeader, StatusPill } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { GitBranch, Play, RefreshCw, ShieldCheck } from "@/ui/icon-registry";

type HarnessRoute = {
  id: string;
  model_id: string;
  node: string;
  runtime: string;
  role: string;
  status: string;
  status_reason?: string;
  capabilities: string[];
  max_context_tokens: number;
  eligible_for: string[];
};

type HarnessTask = {
  id?: string;
  status?: string;
  status_label?: string;
  summary?: string;
  human_title?: string;
  artifacts?: Array<{ name?: string; path?: string }>;
  events?: Array<{ seq?: number; summary?: string; checkpoint?: string }>;
  metadata?: { demo?: { enabled?: boolean; model_used?: boolean; workspace?: string } };
};

type RoutesResponse = { routes?: HarnessRoute[]; selection?: { policy?: string } };
type TaskResponse = { task?: HarnessTask; current?: HarnessTask; events?: HarnessTask["events"] };

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Harness request failed (${response.status})`);
  return payload;
}

function toneForStatus(status: string): "default" | "good" | "warning" | "danger" {
  if (status === "ready" || status === "done" || status === "complete") return "good";
  if (status === "unavailable" || status === "blocked") return "danger";
  if (status === "degraded" || status === "needs_review") return "warning";
  return "default";
}

function formatContext(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k context`;
  return `${tokens} context`;
}

export default function HarnessPage() {
  const [routes, setRoutes] = useState<HarnessRoute[]>([]);
  const [selectionPolicy, setSelectionPolicy] = useState("harness_decides");
  const [task, setTask] = useState<HarnessTask | null>(null);
  const [events, setEvents] = useState<HarnessTask["events"]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const loadRoutes = useCallback(async () => {
    const payload = await readJson<RoutesResponse>("/api/harness/routes");
    setRoutes(payload.routes ?? []);
    setSelectionPolicy(payload.selection?.policy ?? "harness_decides");
  }, []);

  const loadTask = useCallback(async (taskId?: string) => {
    const target = taskId
      ? `/api/harness/tasks/${encodeURIComponent(taskId)}`
      : "/api/harness/tasks/current";
    const payload = await readJson<TaskResponse>(target);
    const nextTask = payload.task ?? payload.current ?? null;
    setTask(nextTask);
    if (nextTask?.id) {
      const eventPayload = await readJson<TaskResponse>(
        `/api/harness/tasks/${encodeURIComponent(nextTask.id)}/events?after=0`,
      );
      setEvents(eventPayload.events ?? nextTask.events ?? []);
    } else {
      setEvents([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    setError("");
    try {
      await Promise.all([loadRoutes(), loadTask()]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Harness is unavailable");
    } finally {
      setLoading(false);
    }
  }, [loadRoutes, loadTask]);

  useMountSubscription(() => {
    void refresh();
  }, [refresh]);

  useMountSubscription(() => {
    if (!task?.id || ["done", "stopped", "blocked"].includes(task.status ?? "")) return;
    const timer = window.setTimeout(() => {
      void loadTask(task.id).catch((nextError) =>
        setError(nextError instanceof Error ? nextError.message : "Task refresh failed"),
      );
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [loadTask, task?.id, task?.status]);

  const runCanary = async () => {
    setRunning(true);
    setError("");
    try {
      const payload = await readJson<TaskResponse & { task?: HarnessTask }>("/api/harness/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "read_only_canary",
          objective: "Verify the Local Studio to Agentic Harness task boundary",
        }),
      });
      const nextTask = payload.task ?? null;
      setTask(nextTask);
      setEvents(nextTask?.events ?? []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Canary could not start");
    } finally {
      setRunning(false);
    }
  };

  return (
    <AppPage>
      <PageContainer width="lg" className="pt-6 sm:pt-8">
        <PageHeader
          eyebrow="Agentic Harness"
          title="Cluster execution"
          description="Local Studio is the operator surface. Harness owns task state, routing, events, and evidence."
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="icon"
                size="md"
                aria-label="Refresh Harness"
                title="Refresh"
                onClick={() => void refresh()}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Play className="h-3.5 w-3.5" />}
                loading={running}
                onClick={() => void runCanary()}
              >
                Run safe canary
              </Button>
            </div>
          }
        />

        {error ? <ErrorBox className="mb-5">{error}</ErrorBox> : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]">
          <Card
            title="Live route registry"
            description={`Harness-owned live probes · selection policy: ${selectionPolicy}`}
          >
            {loading && routes.length === 0 ? (
              <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
                Checking Node1 and Node2...
              </p>
            ) : routes.length === 0 ? (
              <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">No routes reported.</p>
            ) : (
              <div className="divide-y divide-(--ui-border)">
                {routes.map((route) => (
                  <div
                    key={route.id}
                    className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <GitBranch className="h-4 w-4 text-(--ui-muted)" />
                        <span className="truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
                          {route.model_id}
                        </span>
                        <StatusPill tone={toneForStatus(route.status)} variant="badge">
                          {route.status}
                        </StatusPill>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
                        <span>{route.node}</span>
                        <span>{route.runtime}</span>
                        <span>{route.role}</span>
                        <span>{formatContext(route.max_context_tokens)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 sm:justify-end">
                      {route.capabilities.map((capability) => (
                        <span
                          key={capability}
                          className="rounded-full bg-(--ui-fg)/5 px-2 py-1 text-[length:var(--fs-xs)] text-(--ui-muted)"
                        >
                          {capability}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Ownership boundary" description="The two products have different jobs.">
            <div className="space-y-3 text-[length:var(--fs-sm)]">
              <BoundaryRow
                icon={<ShieldCheck className="h-4 w-4" />}
                label="Harness"
                value="Executor, router, durable state, events, artifacts"
              />
              <BoundaryRow
                icon={<GitBranch className="h-4 w-4" />}
                label="Local Studio"
                value="Operator UI and model/chat surface"
              />
              <div className="rounded-xl bg-(--ui-fg)/5 p-3 text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
                The canary is intentionally credential-free and isolated. It proves the client path
                without sending work to vLLM or changing your connected project.
              </div>
            </div>
          </Card>
        </div>

        <Card
          className="mt-4"
          title="Harness task"
          description="The safe canary uses the real Harness lifecycle and returns task evidence through the integration API."
        >
          {!task?.id ? (
            <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">No task loaded.</p>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.6fr)]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={toneForStatus(task.status ?? "")} variant="badge">
                    {task.status_label ?? task.status ?? "unknown"}
                  </StatusPill>
                  <code className="text-[length:var(--fs-xs)] text-(--ui-muted)">{task.id}</code>
                </div>
                <p className="mt-3 text-[length:var(--fs-sm)] text-(--ui-fg)">
                  {task.summary ?? task.human_title}
                </p>
                <div className="mt-4 space-y-2">
                  {(events ?? []).slice(-6).map((event, index) => (
                    <div
                      key={`${event.seq ?? index}-${event.checkpoint ?? "event"}`}
                      className="flex gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)"
                    >
                      <span className="shrink-0 tabular-nums">{event.seq ?? "·"}</span>
                      <span>{event.summary ?? event.checkpoint ?? "Harness event"}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-(--ui-fg)/5 p-3">
                <div className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
                  Evidence
                </div>
                <div className="mt-2 text-[length:var(--fs-sm)] text-(--ui-fg)">
                  {task.artifacts?.length ?? 0} artifact{task.artifacts?.length === 1 ? "" : "s"}
                </div>
                <div className="mt-2 space-y-1">
                  {(task.artifacts ?? []).map((artifact) => (
                    <div
                      key={artifact.path ?? artifact.name}
                      className="truncate text-[length:var(--fs-xs)] text-(--ui-muted)"
                    >
                      {artifact.name ?? artifact.path}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      </PageContainer>
    </AppPage>
  );
}

function BoundaryRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-(--ui-muted)">{icon}</span>
      <div className="min-w-0">
        <div className="text-(--ui-fg)">{label}</div>
        <div className="mt-0.5 text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
          {value}
        </div>
      </div>
    </div>
  );
}
