"use client";

import { useCallback, useState, type ReactNode } from "react";
import { AppPage, Button, Card, ErrorBox, PageContainer, PageHeader, StatusPill } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  describeGoalOutcome,
  goalStartBlocker,
  isTerminalTaskStatus,
  resolveTaskEnvelope,
  startTaskPolling,
  stripGoalCommandPrefix,
  type HarnessTask,
  type ManagedGoalTask,
  type ManagedTaskResponse,
  type TaskResponse,
} from "./harness-page-model";
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

type RoutesResponse = { routes?: HarnessRoute[]; selection?: { policy?: string } };
type ManagedMode = {
  key: string;
  label: string;
  best_for?: string;
  caution?: string;
};
type ManagedProfile = {
  key: string;
  label: string;
  summary?: string;
  caution?: string;
};
type ManagedModesResponse = {
  kind?: string;
  default?: string;
  default_execution_profile?: string;
  modes?: ManagedMode[];
  execution_profiles?: ManagedProfile[];
};
type ManagedSetupResponse = {
  allowed_api_key_envs?: string[];
  suggested_check?: string;
  verification_command?: string;
  verification_contract?: { shell?: boolean; summary?: string };
  workspace?: string;
  worker?: { label?: string; type?: string };
  configured?: boolean;
  provider?: {
    endpoint?: string;
    model?: string;
    api_key_env?: string;
    data_location?: string;
  };
};
type GoalBackend = "managed" | "provider";
async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Harness request failed (${response.status})`);
  return payload;
}

function toneForStatus(status: string): "default" | "good" | "warning" | "danger" {
  if (status === "ready" || status === "done" || status === "complete") return "good";
  if (status === "unavailable" || status === "blocked" || status === "failed") return "danger";
  // "stopped" is a real interruption, not a neutral resting state: showing it in
  // the default tone made a halted goal look the same as a running one.
  if (status === "degraded" || status === "needs_review" || status === "stopped") return "warning";
  return "default";
}

function formatContext(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k context`;
  return `${tokens} context`;
}

function isManagedGoalTerminal(task: ManagedGoalTask | null): boolean {
  return (
    !task?.id ||
    isTerminalTaskStatus(task.status) ||
    task.status === "needs_review" ||
    task.status === "ready"
  );
}

function managedTaskFromResponse(payload: ManagedTaskResponse): ManagedGoalTask | null {
  return resolveTaskEnvelope(payload as TaskResponse) as ManagedGoalTask | null;
}

// The page coordinates route, task, event, and evidence state in one operator surface.
// eslint-disable-next-line complexity
export default function HarnessPage({ initialGoal = "" }: { initialGoal?: string }) {
  const [routes, setRoutes] = useState<HarnessRoute[]>([]);
  const [selectionPolicy, setSelectionPolicy] = useState("harness_decides");
  const [selectedRoute, setSelectedRoute] = useState("auto");
  const [task, setTask] = useState<HarnessTask | null>(null);
  const [events, setEvents] = useState<HarnessTask["events"]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [goal, setGoal] = useState(initialGoal);
  const [goalBackend, setGoalBackend] = useState<GoalBackend>("managed");
  const [goalMode, setGoalMode] = useState("local");
  const [goalProfile, setGoalProfile] = useState("");
  const [goalFeedback, setGoalFeedback] = useState("");
  const [managedTask, setManagedTask] = useState<ManagedGoalTask | null>(null);
  const [managedEvents, setManagedEvents] = useState<NonNullable<HarnessTask["events"]>>([]);
  const [managedModes, setManagedModes] = useState<ManagedMode[]>([]);
  const [managedProfiles, setManagedProfiles] = useState<ManagedProfile[]>([]);
  const [managedSetup, setManagedSetup] = useState<ManagedSetupResponse | null>(null);
  const [goalLoading, setGoalLoading] = useState(true);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState("");
  const [providerEndpoint, setProviderEndpoint] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [providerApiKeyEnv, setProviderApiKeyEnv] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerVerificationCommand, setProviderVerificationCommand] = useState("");
  const [providerRemoteConfirmed, setProviderRemoteConfirmed] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");

  const loadRoutes = useCallback(async () => {
    const payload = await readJson<RoutesResponse>("/api/harness/routes");
    setRoutes(payload.routes ?? []);
    setSelectionPolicy(payload.selection?.policy ?? "harness_decides");
  }, []);

  const loadTask = useCallback(async (taskId?: string, signal?: AbortSignal) => {
    const target = taskId
      ? `/api/harness/tasks/${encodeURIComponent(taskId)}`
      : "/api/harness/tasks/current";
    const payload = await readJson<TaskResponse>(target, { signal });
    if (signal?.aborted) return;
    const nextTask = resolveTaskEnvelope(payload);
    setTask(nextTask);
    if (nextTask?.id) {
      const eventPayload = await readJson<TaskResponse>(
        `/api/harness/tasks/${encodeURIComponent(nextTask.id)}/events?after=0`,
        { signal },
      );
      if (signal?.aborted) return;
      setEvents(eventPayload.events ?? nextTask.events ?? []);
    } else {
      setEvents([]);
    }
  }, []);

  /** Task + events only. This is the poll payload: `modes` and `setup` do not
   *  change while a goal runs, so re-fetching them every interval was three
   *  extra round trips per tick for state that never moved. */
  const loadManagedTask = useCallback(
    async (signal?: AbortSignal, backend: GoalBackend = goalBackend) => {
      const prefix = backend === "provider" ? "/api/harness/provider" : "/api/harness/managed";
      const taskPayload = await readJson<ManagedTaskResponse>(`${prefix}/tasks/current`, {
        signal,
      });
      if (signal?.aborted) return;
      const nextTask = managedTaskFromResponse(taskPayload);
      setManagedTask(nextTask);
      if (nextTask?.id) {
        const eventPayload = await readJson<ManagedTaskResponse>(`${prefix}/tasks/current/events`, {
          signal,
        });
        if (signal?.aborted) return;
        setManagedEvents(eventPayload.events ?? nextTask.events ?? []);
      } else {
        setManagedEvents(nextTask?.events ?? []);
      }
    },
    [goalBackend],
  );

  /** Full load: setup/modes plus the current task. Used on mount and whenever
   *  the selected goal engine changes, not on the polling interval. */
  const loadManaged = useCallback(
    async (signal?: AbortSignal, backend: GoalBackend = goalBackend) => {
      const prefix = backend === "provider" ? "/api/harness/provider" : "/api/harness/managed";
      const [modesPayload, setupPayload] = await Promise.all([
        readJson<ManagedModesResponse>(`${prefix}/modes`, { signal }),
        readJson<ManagedSetupResponse>(`${prefix}/setup`, { signal }),
        // Task and events stay in the same parallel batch, so first paint is no
        // slower than before the poll payload was split out.
        loadManagedTask(signal, backend),
      ]);
      if (signal?.aborted) return;
      setManagedModes(modesPayload.modes ?? []);
      setManagedProfiles(modesPayload.execution_profiles ?? []);
      setManagedSetup(setupPayload);
      const availableModes = modesPayload.modes ?? [];
      const fallbackMode = backend === "provider" ? (modesPayload.default ?? "plan") : "local";
      setGoalMode((current) =>
        availableModes.some((mode) => mode.key === current) ? current : fallbackMode,
      );
      const availableProfiles = modesPayload.execution_profiles ?? [];
      const fallbackProfile =
        modesPayload.default_execution_profile ?? availableProfiles[0]?.key ?? "";
      setGoalProfile((current) =>
        availableProfiles.some((profile) => profile.key === current) ? current : fallbackProfile,
      );
      if (backend === "provider") {
        // Switching into the provider lane must reflect that lane's saved
        // setup, not stale values left in the form by a previous selection.
        // verification_command is the effective persisted check; the
        // detected suggestion is only the first-run fallback.
        setProviderEndpoint(setupPayload.provider?.endpoint || "");
        setProviderModel(setupPayload.provider?.model || "");
        setProviderApiKeyEnv(setupPayload.provider?.api_key_env || "");
        setProviderVerificationCommand(
          setupPayload.verification_command || setupPayload.suggested_check || "",
        );
      }
    },
    [goalBackend, loadManagedTask],
  );

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
    void loadManaged()
      .catch((nextError) =>
        setGoalError(nextError instanceof Error ? nextError.message : "Managed goal unavailable"),
      )
      .finally(() => setGoalLoading(false));
  }, [loadManaged]);

  useMountSubscription(() => {
    if (!task?.id || isTerminalTaskStatus(task.status)) return;
    const taskId = task.id;
    return startTaskPolling({
      intervalMs: 3000,
      load: (signal) => loadTask(taskId, signal),
      onError: (nextError) =>
        setError(nextError instanceof Error ? nextError.message : "Task refresh failed"),
    });
  }, [loadTask, task?.id, task?.status]);

  useMountSubscription(() => {
    if (isManagedGoalTerminal(managedTask)) return;
    return startTaskPolling({
      intervalMs: 3000,
      load: (signal) => loadManagedTask(signal),
      onError: (nextError) =>
        setGoalError(nextError instanceof Error ? nextError.message : "Goal refresh failed"),
    });
  }, [loadManagedTask, managedTask?.id, managedTask?.status]);

  const goalApiPrefix =
    goalBackend === "provider" ? "/api/harness/provider" : "/api/harness/managed";

  const startGoal = async () => {
    // Validate on submit rather than only disabling the button, so a new user is
    // told why nothing happened instead of facing an inert control.
    const blocker = goalStartBlocker({
      goal,
      backend: goalBackend,
      providerConfigured: managedSetup?.configured === true,
      setupLoading: goalLoading,
      activeTaskStatus: managedTask?.status,
    });
    if (blocker) {
      setGoalError(blocker);
      return;
    }
    const objective = stripGoalCommandPrefix(goal);
    setGoalBusy(true);
    setGoalError("");
    try {
      const payload = await readJson<ManagedTaskResponse>(`${goalApiPrefix}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          goalBackend === "provider"
            ? { objective, strategy: goalMode }
            : {
                objective,
                mode: goalMode,
                ...(goalProfile ? { execution_profile: goalProfile } : {}),
              },
        ),
      });
      const nextTask = managedTaskFromResponse(payload);
      setManagedTask(nextTask);
      setManagedEvents(nextTask?.events ?? []);
      if (nextTask?.status === "blocked" || nextTask?.status === "needs_review") {
        setGoalError(nextTask.summary ?? "The goal needs attention before it can continue.");
      }
    } catch (nextError) {
      setGoalError(nextError instanceof Error ? nextError.message : "Goal could not start");
    } finally {
      setGoalBusy(false);
    }
  };

  const runManagedAction = async (action: "stop" | "continue" | "accept") => {
    if (!managedTask?.id) {
      setGoalError("The current goal changed. Refresh before trying that action again.");
      return;
    }
    setGoalBusy(true);
    setGoalError("");
    try {
      const payload = await readJson<ManagedTaskResponse>(
        `${goalApiPrefix}/tasks/current/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task_id: managedTask.id,
            ...(action === "continue" ? { feedback: goalFeedback.trim() } : {}),
          }),
        },
      );
      const nextTask = managedTaskFromResponse(payload);
      setManagedTask(nextTask);
      setManagedEvents(nextTask?.events ?? []);
      if (action === "continue") setGoalFeedback("");
    } catch (nextError) {
      setGoalError(nextError instanceof Error ? nextError.message : `Goal ${action} failed`);
    } finally {
      setGoalBusy(false);
    }
  };

  const configureProvider = async (testOnly: boolean) => {
    if (!providerEndpoint.trim() || !providerModel.trim()) {
      setProviderMessage("");
      setGoalError(
        "Enter both an OpenAI-compatible endpoint and a model ID before testing or saving.",
      );
      return;
    }
    setProviderBusy(true);
    setProviderMessage("");
    setGoalError("");
    try {
      const payload = {
        execution: providerEndpoint.trim().startsWith("https://") ? "cloud_model" : "local_model",
        endpoint: providerEndpoint.trim(),
        model: providerModel.trim(),
        api_key_env: providerApiKeyEnv.trim(),
        api_key: providerApiKey.trim(),
        verification_command: providerVerificationCommand.trim(),
        confirm_remote_data: providerRemoteConfirmed,
      };
      const response = await readJson<ManagedSetupResponse>(
        `${goalApiPrefix}/setup${testOnly ? "/test" : ""}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!testOnly) {
        setManagedSetup(response);
        setProviderApiKey("");
      }
      setProviderMessage(testOnly ? "Connection test passed." : "Provider saved.");
    } catch (nextError) {
      setProviderMessage("");
      setGoalError(nextError instanceof Error ? nextError.message : "Provider setup failed");
    } finally {
      setProviderBusy(false);
    }
  };

  const managedGoalMode: ManagedMode = {
    ...(managedModes.find((mode) => mode.key === "local") ?? {
      key: "local",
      label: "Managed goal loop",
      best_for: "A durable goal executed by the configured managed worker.",
    }),
    label: "Managed goal loop",
    best_for: "Runs through the configured managed worker and keeps durable task state.",
  };
  const providerModeOptions = managedModes.length
    ? managedModes
    : [
        {
          key: goalMode || "quick",
          label: "Standard goal loop",
          best_for: "Plan, act, verify, and keep working until the goal reaches a terminal result.",
        },
      ];
  const selectedMode =
    goalBackend === "provider"
      ? (providerModeOptions.find((mode) => mode.key === goalMode) ?? providerModeOptions[0])
      : managedGoalMode;

  const startBlocker = goalStartBlocker({
    goal,
    backend: goalBackend,
    providerConfigured: managedSetup?.configured === true,
    setupLoading: goalLoading,
    activeTaskStatus: managedTask?.status,
  });
  const showStartBlocker = Boolean(startBlocker && !goalError && !error);
  const goalOutcome = describeGoalOutcome(managedTask);

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
      const nextTask = resolveTaskEnvelope(payload);
      setTask(nextTask);
      setEvents(nextTask?.events ?? []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Canary could not start");
    } finally {
      setRunning(false);
    }
  };

  const runAnalysis = async () => {
    setRunning(true);
    setError("");
    try {
      const payload = await readJson<TaskResponse & { task?: HarnessTask }>("/api/harness/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "read_only_analysis",
          ...(selectedRoute === "auto" ? {} : { route_id: selectedRoute }),
          objective:
            "Use the selected cluster vLLM route to confirm the Harness execution boundary. " +
            "Report the selected model and explain that this analysis is read-only; do not change files.",
        }),
      });
      const nextTask = resolveTaskEnvelope(payload);
      setTask(nextTask);
      setEvents(nextTask?.events ?? []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Model analysis could not start");
    } finally {
      setRunning(false);
    }
  };

  return (
    <AppPage>
      <PageContainer width="lg" className="pt-6 sm:pt-8">
        <PageHeader
          eyebrow="Goals"
          title="What should your agent accomplish?"
          description="Describe the result in plain language. The harness will keep working, verify the outcome, and ask only when it needs your decision."
          actions={
            <Button
              variant="icon"
              size="md"
              aria-label="Refresh goals"
              title="Refresh"
              onClick={() => void refresh()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        <Card
          className="mb-4"
          title="Work on a goal"
          description="Type one objective, then let the managed harness keep working until it has evidence or needs your decision."
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
            <div>
              <label
                htmlFor="harness-goal"
                className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)"
              >
                What do you want done?
              </label>
              <textarea
                id="harness-goal"
                value={goal}
                onChange={(event) => {
                  setGoal(event.target.value);
                  if (goalError) setGoalError("");
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void startGoal();
                  }
                }}
                rows={5}
                placeholder="Describe the outcome in plain language, for example: Review the Local Studio integration, make a bounded improvement, and verify it end to end."
                aria-describedby={
                  showStartBlocker ? "harness-goal-hint harness-goal-blocker" : "harness-goal-hint"
                }
                aria-invalid={Boolean(goalError && !goal.trim())}
                className="mt-2 block w-full resize-y rounded-xl border border-(--ui-border) bg-(--ui-bg) px-3 py-3 text-[length:var(--fs-md)] leading-relaxed text-(--ui-fg) outline-none transition focus:border-(--ui-accent) focus:ring-2 focus:ring-(--ui-accent)/20"
                disabled={goalBusy}
              />
              <div
                id="harness-goal-hint"
                className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)"
              >
                <span>Plain language is enough; /goal is optional.</span>
                <span>⌘/Ctrl + Enter to start</span>
              </div>
              {managedTask?.id ? (
                <div
                  role="status"
                  className="mt-3 rounded-xl border border-(--ui-border) bg-(--ui-fg)/5 p-3 text-[length:var(--fs-sm)]"
                >
                  <div className="font-medium text-(--ui-fg)">
                    {isManagedGoalTerminal(managedTask)
                      ? "Last task in this workspace"
                      : "A goal is already running in this shared workspace"}
                  </div>
                  <p className="mt-1 leading-relaxed text-(--ui-muted)">
                    {isManagedGoalTerminal(managedTask)
                      ? "The task shown below is history. You can start a new goal."
                      : "Continue or stop the current goal before starting another one."}
                  </p>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="harness-goal-backend"
                    className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)"
                  >
                    Goal engine
                  </label>
                  <select
                    id="harness-goal-backend"
                    value={goalBackend}
                    onChange={(event) => {
                      const nextBackend = event.target.value as GoalBackend;
                      setGoalBackend(nextBackend);
                      setManagedTask(null);
                      setManagedEvents([]);
                      setProviderMessage("");
                      setGoalError("");
                      // Drop the previous engine's setup so the provider gate
                      // fails closed instead of reading the other backend's
                      // `configured` flag until the new payload lands.
                      // useMountSubscription diffs its deps and re-subscribes, so
                      // changing goalBackend gives loadManaged a new identity and
                      // re-runs that subscription; its finally() clears goalLoading.
                      setManagedSetup(null);
                      setGoalLoading(true);
                    }}
                    className="mt-2 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                    disabled={goalBusy || providerBusy}
                  >
                    <option value="managed">Configured managed worker</option>
                    <option value="provider">Any OpenAI-compatible model</option>
                  </select>
                  <p className="mt-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
                    {goalBackend === "provider"
                      ? "Use a local, LAN, or cloud endpoint configured below."
                      : "Use the deployment's existing durable worker and route policy."}
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="harness-goal-mode"
                    className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)"
                  >
                    Work mode
                  </label>
                  <select
                    id="harness-goal-mode"
                    value={goalMode}
                    onChange={(event) => setGoalMode(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                    disabled={goalBusy}
                  >
                    {(goalBackend === "provider" ? providerModeOptions : [managedGoalMode]).map(
                      (mode) => (
                        <option key={mode.key} value={mode.key}>
                          {mode.label}
                        </option>
                      ),
                    )}
                  </select>
                  <p className="mt-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
                    {selectedMode?.best_for ?? "Loading work strategies..."}
                  </p>
                </div>
                {goalBackend === "managed" ? (
                  <div>
                    <label
                      htmlFor="harness-goal-profile"
                      className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)"
                    >
                      Execution route
                    </label>
                    <select
                      id="harness-goal-profile"
                      value={goalProfile}
                      onChange={(event) => setGoalProfile(event.target.value)}
                      className="mt-2 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                      disabled={goalBusy}
                    >
                      {(managedProfiles.length
                        ? managedProfiles
                        : [{ key: goalProfile, label: "Configured model profile" }]
                      ).map((profile) => (
                        <option key={profile.key} value={profile.key}>
                          {profile.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
                      {managedProfiles.find((profile) => profile.key === goalProfile)?.summary ??
                        "The managed deployment chooses the endpoint and model for this profile."}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-(--ui-border) p-3 text-[length:var(--fs-xs)] text-(--ui-muted)">
                    <div className="uppercase tracking-[0.12em]">Selected model</div>
                    <div className="mt-2 break-words text-(--ui-fg)">
                      {goalLoading
                        ? "Loading provider settings…"
                        : providerModel || "Configure a model below"}
                    </div>
                    <div className="mt-1 break-all">
                      {goalLoading ? "" : providerEndpoint || "No endpoint configured"}
                    </div>
                  </div>
                )}
              </div>

              {goalBackend === "provider" ? (
                <div className="mt-4 rounded-xl border border-(--ui-border) p-4">
                  <div className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
                    Model provider
                  </div>
                  <p className="mt-2 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
                    Enter any OpenAI-compatible chat-completions endpoint and model ID. Keep keys in
                    an environment variable when possible; a session key is cleared after restart.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                      Endpoint
                      <input
                        value={providerEndpoint}
                        onChange={(event) => setProviderEndpoint(event.target.value)}
                        placeholder="http://127.0.0.1:8000/v1/chat/completions"
                        className="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                        disabled={providerBusy || goalBusy}
                      />
                    </label>
                    <label className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                      Model ID
                      <input
                        value={providerModel}
                        onChange={(event) => setProviderModel(event.target.value)}
                        placeholder="your-provider/model-name"
                        className="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                        disabled={providerBusy || goalBusy}
                      />
                    </label>
                    <label className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                      Saved credential
                      <select
                        value={providerApiKeyEnv}
                        onChange={(event) => setProviderApiKeyEnv(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                        disabled={providerBusy || goalBusy}
                      >
                        <option value="">No saved credential</option>
                        {(managedSetup?.allowed_api_key_envs ?? []).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block leading-relaxed">
                        Only credential names approved by this installation are available.
                      </span>
                    </label>
                    <label className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                      Session API key
                      <input
                        type="password"
                        value={providerApiKey}
                        onChange={(event) => setProviderApiKey(event.target.value)}
                        placeholder="Optional; never written to project state"
                        autoComplete="new-password"
                        className="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                        disabled={providerBusy || goalBusy}
                      />
                    </label>
                  </div>
                  <label className="mt-3 block text-[length:var(--fs-xs)] text-(--ui-muted)">
                    Independent verification command (required)
                    <input
                      value={providerVerificationCommand}
                      onChange={(event) => setProviderVerificationCommand(event.target.value)}
                      placeholder="The workspace's detected check will be used when available"
                      className="mt-1 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                      disabled={providerBusy || goalBusy}
                    />
                    <span className="mt-1 block leading-relaxed">
                      {managedSetup?.verification_contract?.summary ??
                        (providerVerificationCommand.trim()
                          ? "This check is saved with the provider setup and verifies each goal."
                          : "Saving requires a check. If this workspace already has one, it will appear here after setup loads.")}
                    </span>
                  </label>
                  <label className="mt-3 flex items-start gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
                    <input
                      type="checkbox"
                      checked={providerRemoteConfirmed}
                      onChange={(event) => setProviderRemoteConfirmed(event.target.checked)}
                      className="mt-0.5"
                      disabled={providerBusy || goalBusy}
                    />
                    I understand that a cloud endpoint may receive selected prompts, file excerpts,
                    and tool results.
                  </label>
                  {providerMessage ? (
                    <p className="mt-3 text-[length:var(--fs-sm)] text-(--ui-fg)">
                      {providerMessage}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={providerBusy}
                      disabled={
                        providerBusy ||
                        goalBusy ||
                        goalLoading ||
                        !providerEndpoint.trim() ||
                        !providerModel.trim()
                      }
                      onClick={() => void configureProvider(true)}
                    >
                      Test connection
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={providerBusy}
                      disabled={
                        providerBusy ||
                        goalBusy ||
                        goalLoading ||
                        !providerEndpoint.trim() ||
                        !providerModel.trim()
                      }
                      onClick={() => void configureProvider(false)}
                    >
                      Save provider
                    </Button>
                  </div>
                </div>
              ) : null}

              {goalError ? <ErrorBox className="mt-4">{goalError}</ErrorBox> : null}
              {!goalError && error ? <ErrorBox className="mt-4">{error}</ErrorBox> : null}

              {showStartBlocker ? (
                <p
                  id="harness-goal-blocker"
                  className="mt-4 text-[length:var(--fs-sm)] text-(--ui-muted)"
                >
                  {startBlocker}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Play className="h-3.5 w-3.5" />}
                  loading={goalBusy}
                  // Loading and in-flight states disable the control; other
                  // reasons are reported by startGoal so they can be read.
                  disabled={goalBusy || goalLoading}
                  aria-describedby={showStartBlocker ? "harness-goal-blocker" : undefined}
                  onClick={() => void startGoal()}
                >
                  Start goal
                </Button>
                {managedTask?.id && !isManagedGoalTerminal(managedTask) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={goalBusy}
                    disabled={goalBusy}
                    onClick={() => void runManagedAction("stop")}
                  >
                    Stop goal
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl bg-(--ui-fg)/5 p-3">
                <div className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
                  What happens next
                </div>
                <div className="mt-2 space-y-2 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-fg)">
                  <p>
                    {goalBackend === "provider"
                      ? "The Harness owns the durable goal loop and uses the configured provider/model."
                      : "The configured managed worker owns the durable goal loop and route policy."}
                  </p>
                  <p>It can plan, act, check, and continue without another prompt.</p>
                  <p>
                    It keeps working until complete, blocked, paused, budget-limited, or awaiting
                    review.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-(--ui-border) p-3 text-[length:var(--fs-xs)] text-(--ui-muted)">
                <div className="font-medium text-(--ui-fg)">Live target</div>
                <div className="mt-1 break-words">
                  {/* Avoid exposing provider workspace paths in a generic
                      provider session; managed mode may show its operator target. */}
                  {goalBackend === "provider"
                    ? "Configured provider workspace"
                    : (managedSetup?.workspace ??
                      (goalLoading ? "Loading workspace..." : "No workspace reported yet"))}
                </div>
                <div className="mt-1">
                  {managedSetup?.worker?.label ??
                    (goalBackend === "provider" ? "Provider model agent" : "Managed goal runtime")}
                </div>
              </div>
            </div>
          </div>

          {managedTask?.id ? (
            <div className="mt-5 border-t border-(--ui-border) pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={toneForStatus(managedTask.status ?? "")} variant="badge">
                  {managedTask.status_label ?? managedTask.status ?? "working"}
                </StatusPill>
                <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                  {managedTask.progress?.label ?? managedTask.current?.checkpoint ?? "Managed goal"}
                </span>
                <code className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                  {managedTask.id}
                </code>
              </div>
              <p className="mt-3 text-[length:var(--fs-sm)] text-(--ui-fg)">
                {managedTask.objective ?? managedTask.summary ?? "Goal is running."}
              </p>
              {goalOutcome && goalOutcome.state !== "running" ? (
                <div
                  role="status"
                  className="mt-3 rounded-xl border border-(--ui-border) p-3 text-[length:var(--fs-sm)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={goalOutcome.tone} variant="badge">
                      {goalOutcome.headline}
                    </StatusPill>
                  </div>
                  <p className="mt-2 leading-relaxed text-(--ui-muted)">{goalOutcome.detail}</p>
                </div>
              ) : null}
              {managedTask.progress?.determinate ? (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-(--ui-fg)/10">
                  <div
                    className="h-full rounded-full bg-(--ui-accent) transition-all"
                    style={{
                      width: `${Math.max(0, Math.min(100, managedTask.progress.percent ?? 0))}%`,
                    }}
                  />
                </div>
              ) : null}
              {managedTask.summary && goalOutcome?.state === "running" ? (
                <p className="mt-3 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
                  {managedTask.summary}
                </p>
              ) : null}
              {managedTask.status === "needs_review" || managedTask.status === "blocked" ? (
                <div className="mt-4 rounded-xl border border-(--ui-border) p-3">
                  <label
                    htmlFor="harness-goal-feedback"
                    className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)"
                  >
                    Feedback to continue
                  </label>
                  <textarea
                    id="harness-goal-feedback"
                    value={goalFeedback}
                    onChange={(event) => setGoalFeedback(event.target.value)}
                    rows={3}
                    placeholder="Tell the worker what to address next, or leave blank to continue."
                    className="mt-2 block w-full resize-y rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                    disabled={goalBusy}
                  />
                  <Button
                    className="mt-3"
                    variant="secondary"
                    size="sm"
                    loading={goalBusy}
                    disabled={goalBusy}
                    onClick={() => void runManagedAction("continue")}
                  >
                    Continue goal
                  </Button>
                  {managedTask.status === "needs_review" ? (
                    <Button
                      className="mt-3 ml-2"
                      variant="primary"
                      size="sm"
                      loading={goalBusy}
                      disabled={goalBusy}
                      onClick={() => void runManagedAction("accept")}
                    >
                      Accept result
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.55fr)]">
                <div className="space-y-2">
                  {(managedEvents ?? []).slice(-8).map((event, index) => (
                    <div
                      key={`${event.seq ?? index}-${event.checkpoint ?? "goal-event"}`}
                      className="flex gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)"
                    >
                      <span className="shrink-0 tabular-nums">{event.seq ?? "·"}</span>
                      <span>{event.summary ?? event.checkpoint ?? "Goal event"}</span>
                    </div>
                  ))}
                  {managedEvents.length === 0 ? (
                    <p className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                      {goalLoading ? "Loading goal state..." : "Progress events will appear here."}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-xl bg-(--ui-fg)/5 p-3">
                  <div className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
                    Evidence
                  </div>
                  <div className="mt-2 text-[length:var(--fs-sm)] text-(--ui-fg)">
                    {managedTask.verification?.length ?? 0} verification checks ·{" "}
                    {managedTask.changed_files?.length ?? 0} owned paths
                  </div>
                  <div className="mt-2 space-y-1">
                    {(managedTask.artifacts ?? []).slice(0, 3).map((artifact) => (
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
            </div>
          ) : goalLoading ? (
            <p className="mt-5 border-t border-(--ui-border) pt-5 text-[length:var(--fs-sm)] text-(--ui-muted)">
              Loading goal setup...
            </p>
          ) : null}
        </Card>

        <details className="rounded-xl border border-(--ui-border) p-4">
          <summary className="cursor-pointer text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">
            Advanced diagnostics
          </summary>
          <p className="mt-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
            Inspect routes, run a credential-free boundary check, or test a read-only model route.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Play className="h-3.5 w-3.5" />}
              loading={running}
              disabled={running}
              onClick={() => void runCanary()}
            >
              Run safe canary
            </Button>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.8fr)]">
            <Card
              title="Live route registry"
              description={`Harness-owned live probes · selection policy: ${selectionPolicy}`}
            >
              {loading && routes.length === 0 ? (
                <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
                  Checking configured routes...
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
                  The safe canary is credential-free. Model analysis uses the selected vLLM route in
                  a temporary isolated workspace with write tools disabled.
                </div>
                <div className="rounded-xl border border-(--ui-border) p-3">
                  <label
                    htmlFor="harness-route"
                    className="text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)"
                  >
                    Model route
                  </label>
                  <select
                    id="harness-route"
                    value={selectedRoute}
                    onChange={(event) => setSelectedRoute(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-fg)"
                  >
                    <option value="auto">Auto: let the Harness choose</option>
                    {routes.map((route) => (
                      <option key={route.id} value={route.id} disabled={route.status !== "ready"}>
                        {route.node} · {route.model_id} ({route.status})
                      </option>
                    ))}
                  </select>
                  <Button
                    className="mt-3 w-full"
                    variant="secondary"
                    size="sm"
                    icon={<Play className="h-3.5 w-3.5" />}
                    loading={running}
                    disabled={running}
                    onClick={() => void runAnalysis()}
                  >
                    Run vLLM analysis
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <Card
            className="mt-4"
            title="Diagnostic task"
            description="Canary and read-only model checks return task evidence through the integration API."
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
                  {task.metadata?.integration ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
                      <span>
                        {task.metadata.integration.node} · {task.metadata.integration.model_id}
                      </span>
                      <span>{task.metadata.integration.runtime}</span>
                      <span>read-only</span>
                      <span>
                        workspace{" "}
                        {task.metadata.integration.connected_workspace_mutated
                          ? "changed"
                          : "unchanged"}
                      </span>
                    </div>
                  ) : null}
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
        </details>
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
