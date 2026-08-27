"use client";

import { useCallback, useRef, useState } from "react";
import { Effect } from "effect";
import { RIG_NODE_ROLE_LABELS } from "@local-studio/contracts/rigs";
import { GpuSection } from "@/features/dashboard/control-panel/gpu-section";
import { DashboardLayout } from "@/features/dashboard/layout/dashboard-layout";
import { useDashboardData } from "@/features/dashboard/use-dashboard-data";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import { createHeadApiClient, createHeadWorkerApiClient } from "@/lib/api/head-controller";
import { effectInterval } from "@/lib/effect-timers";
import { StatusPill, type UiTone } from "@/ui";
import type {
  CompatibilityReport,
  ConfigData,
  GPU,
  RigNode,
  StudioDiagnostics,
  WorkerStatus,
} from "@/lib/types";
import { SetupChecksSettings } from "./agent-settings-sections";
import { EnginesSection } from "./engines-section";
import { CompatibilitySettings, ServicesSettings } from "./system-settings-section";
import type { ApiConnectionSettings } from "./types";
import { SettingsFactRows, SettingsGroup, type SettingsFactRow } from "./settings-ui";
import type { LogsTarget } from "@/features/logs/use-logs";

type MachineState = {
  label: string;
  tone: UiTone;
};

const machineState = (
  node: RigNode,
  worker: WorkerStatus | undefined,
  headConnected: boolean,
): MachineState => {
  if (worker) {
    return worker.healthy
      ? { label: "online", tone: "good" }
      : { label: "offline", tone: "danger" };
  }
  if (node.role === "head") {
    return headConnected ? { label: "online", tone: "good" } : { label: "offline", tone: "danger" };
  }
  return node.address
    ? { label: "configured", tone: "info" }
    : { label: "unavailable", tone: "warning" };
};

const endpoint = (node: RigNode): string => node.address ?? node.hostname ?? "Not reported";

const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "Not reported";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

type NetworkRates = { receive: number | null; transmit: number | null };

function useMachineDiagnostics(target?: LogsTarget) {
  const [diagnostics, setDiagnostics] = useState<StudioDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [networkRates, setNetworkRates] = useState<NetworkRates>({ receive: null, transmit: null });
  const previous = useRef<{
    sampledAt: number;
    receive: number;
    transmit: number;
  } | null>(null);
  const refresh = useCallback(() => {
    const request = Effect.tryPromise({
      try: () => {
        if (!target || target.kind === "local") return api.getStudioDiagnostics();
        const client =
          target.kind === "head"
            ? createHeadApiClient(target.connection)
            : createHeadWorkerApiClient(target.workerId, target.connection);
        return client.getStudioDiagnostics();
      },
      catch: (cause) => (cause instanceof Error ? cause.message : "Diagnostics unavailable"),
    }).pipe(
      Effect.match({
        onFailure: (message) => setError(message),
        onSuccess: (next) => {
          const sampledAt = Date.parse(next.timestamp);
          const receive = next.network_receive_bytes;
          const transmit = next.network_transmit_bytes;
          const prior = previous.current;
          if (
            prior &&
            receive !== null &&
            transmit !== null &&
            Number.isFinite(sampledAt) &&
            sampledAt > prior.sampledAt
          ) {
            const seconds = (sampledAt - prior.sampledAt) / 1000;
            setNetworkRates({
              receive: Math.max(0, receive - prior.receive) / seconds,
              transmit: Math.max(0, transmit - prior.transmit) / seconds,
            });
          }
          if (receive !== null && transmit !== null && Number.isFinite(sampledAt)) {
            previous.current = { sampledAt, receive, transmit };
          }
          setDiagnostics(next);
          setError(null);
        },
      }),
    );
    void Effect.runPromise(request);
  }, [target]);
  useMountSubscription(() => {
    refresh();
    const timer = effectInterval(refresh, 5_000);
    return () => timer.cancel();
  }, [refresh]);
  return { diagnostics, error, networkRates };
}

function localControllerRows(
  data: ConfigData | null,
  apiSettings: ApiConnectionSettings,
  diagnostics: StudioDiagnostics | null,
  error: string | null,
): SettingsFactRow[] {
  const config = data?.config;
  const rows: SettingsFactRow[] = [
    { label: "Version", value: diagnostics?.app_version ?? "Checking…", mono: true },
    { label: "Update source", value: "Bundled with the desktop release" },
    { label: "Mode", value: config?.controller_mode ?? "standalone" },
    {
      label: "Controller URL",
      value: data?.environment.controller_url ?? apiSettings.backendUrl,
      mono: true,
    },
    { label: "Inference port", value: config?.inference_port ?? 8000, mono: true },
    {
      label: "Models directory",
      value: config?.models_dir ?? "~/models",
      mono: true,
      truncate: true,
    },
    {
      label: "Data directory",
      value: config?.data_dir ?? "data/",
      mono: true,
      truncate: true,
    },
  ];
  if (error) {
    rows.push({
      label: "Version check",
      value: error,
      status: { label: "unavailable", tone: "danger" },
    });
  }
  return rows;
}

function resolveMemory(diagnostics: StudioDiagnostics | null) {
  const total = diagnostics?.memory_total ?? 0;
  const free = diagnostics?.memory_free ?? 0;
  const used = Math.max(0, total - free);
  return { total, free, used, percent: total > 0 ? Math.round((used / total) * 100) : null };
}

function resolveGpuTelemetry(gpus: GPU[]) {
  const memory = gpus.reduce(
    (total, gpu) => ({
      used: total.used + gpu.memory_used_mb,
      capacity: total.capacity + gpu.memory_total_mb,
    }),
    { used: 0, capacity: 0 },
  );
  const readable = gpus.filter((gpu) => gpu.utilization_available !== false);
  const utilization = readable.length
    ? Math.round(readable.reduce((sum, gpu) => sum + gpu.utilization_pct, 0) / readable.length)
    : null;
  return { memory, utilization };
}

const formatRate = (bytesPerSecond: number | null): string => {
  if (bytesPerSecond === null) return "Sampling…";
  if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
};

function localSystemRows(
  diagnostics: StudioDiagnostics | null,
  gpus: GPU[],
  networkRates: NetworkRates,
): SettingsFactRow[] {
  const memory = resolveMemory(diagnostics);
  const gpu = resolveGpuTelemetry(gpus);
  return [
    {
      label: "CPU",
      description: diagnostics?.cpu_model ?? "Processor inventory is loading.",
      value: diagnostics
        ? diagnostics.cpu_usage_percent === null
          ? `${diagnostics.cpu_cores} cores`
          : `${diagnostics.cpu_usage_percent.toFixed(1)}% · ${diagnostics.cpu_cores} cores`
        : "Checking…",
    },
    {
      label: "RAM",
      description: memory.total
        ? `${formatBytes(memory.free)} available`
        : "Memory telemetry is loading.",
      value: memory.total
        ? `${formatBytes(memory.used)} / ${formatBytes(memory.total)}`
        : "Checking…",
      status:
        memory.percent === null
          ? undefined
          : {
              label: `${memory.percent}% used`,
              tone: memory.percent > 90 ? "danger" : "good",
            },
    },
    {
      label: "GPU",
      description: gpus.length
        ? gpus.map((device) => device.name).join(", ")
        : "No discrete GPU telemetry reported.",
      value:
        gpu.utilization === null
          ? `${gpus.length} detected`
          : `${gpu.utilization}% average utilization`,
    },
    {
      label: "GPU memory",
      description: "Memory in use across every visible accelerator.",
      value:
        gpus.some((device) => device.memory_usage_available !== false) && gpu.memory.capacity
          ? `${(gpu.memory.used / 1024).toFixed(1)} / ${(gpu.memory.capacity / 1024).toFixed(1)} GB`
          : gpus.some((device) => device.memory_shared)
            ? "Shared system memory"
            : "Not reported",
    },
    {
      label: "Network",
      value: `↓ ${formatRate(networkRates.receive)} · ↑ ${formatRate(networkRates.transmit)}`,
    },
    {
      label: "Sample",
      value: diagnostics?.timestamp
        ? new Date(diagnostics.timestamp).toLocaleTimeString()
        : "Checking…",
      mono: true,
    },
  ];
}

export function LocalMachineStatus() {
  const data = useDashboardData();
  return (
    <div className="-mx-3 -mt-2 sm:-mx-4">
      <DashboardLayout {...data} />
    </div>
  );
}

export function MachineStatusSettings({
  node,
  worker,
  headConnected,
}: {
  node: RigNode;
  worker?: WorkerStatus;
  headConnected: boolean;
}) {
  const state = machineState(node, worker, headConnected);
  return (
    <SettingsGroup
      title="Model serving"
      description="Current reachability and model-serving workload state for this machine."
      actions={<StatusPill tone={state.tone}>{state.label}</StatusPill>}
    >
      <SettingsFactRows
        rows={[
          { label: "Active streams", value: worker?.active_streams ?? "Not reported" },
          { label: "Available models", value: worker?.models.length ?? "Not reported" },
          {
            label: "Last checked",
            value: worker?.checked_at
              ? new Date(worker.checked_at).toLocaleString()
              : "Not reported",
          },
          ...(worker?.error
            ? [
                {
                  label: "Serving error",
                  value: worker.error,
                  status: { label: "error", tone: "danger" as const },
                },
              ]
            : []),
        ]}
      />
    </SettingsGroup>
  );
}

export function LocalMachineControllerSettings({
  data,
  compatibilityReport,
  apiSettings,
  loading,
  error,
}: {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  apiSettings: ApiConnectionSettings;
  loading: boolean;
  error: string | null;
}) {
  const realtime = useRealtimeStatusStore();
  const local = useMachineDiagnostics();
  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Controller"
        description="Configuration, release ownership, and endpoints for this machine's controller."
        actions={
          <StatusPill tone={realtime.connected ? "good" : "danger"}>
            {realtime.connected ? "online" : "offline"}
          </StatusPill>
        }
      >
        <SettingsFactRows
          rows={localControllerRows(data, apiSettings, local.diagnostics, local.error)}
        />
      </SettingsGroup>
      <SetupChecksSettings
        title="Software & dependencies"
        description="Detected software, local services, and external harnesses required by this controller."
      />
      <EnginesSection runtime={data?.runtime ?? null} />
      <ServicesSettings data={data} apiSettings={apiSettings} loading={loading} error={error} />
      <CompatibilitySettings
        checks={compatibilityReport?.checks ?? []}
        report={compatibilityReport}
      />
    </div>
  );
}

export function MachineControllerSettings({
  node,
  worker,
  headConnected,
  target,
}: {
  node: RigNode;
  worker?: WorkerStatus;
  headConnected: boolean;
  target?: LogsTarget;
}) {
  const state = machineState(node, worker, headConnected);
  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Controller"
        description="Configuration and release ownership for this machine's controller."
        actions={<StatusPill tone={state.tone}>{state.label}</StatusPill>}
      >
        <SettingsFactRows
          rows={[
            { label: "Endpoint", value: endpoint(node), mono: true },
            { label: "Role", value: RIG_NODE_ROLE_LABELS[node.role] },
            { label: "Version", value: "Not reported" },
            { label: "Update source", value: "Managed by the Head deployment" },
          ]}
        />
      </SettingsGroup>
      <SetupChecksSettings
        title="Software & dependencies"
        description="Detected runtimes, tools, browsers, and harnesses reported by this controller."
        target={target}
      />
    </div>
  );
}

export function LocalMachineSystemTelemetry() {
  const realtime = useRealtimeStatusStore();
  const local = useMachineDiagnostics();
  const diagnostics = local.diagnostics;
  const gpus = realtime.gpus.length ? realtime.gpus : (diagnostics?.gpus ?? []);
  return (
    <SettingsGroup
      title="Live system telemetry"
      description="CPU, memory, and accelerator telemetry sampled from this machine every five seconds."
      actions={
        <StatusPill tone={realtime.connected ? "good" : local.error ? "danger" : "info"}>
          {realtime.connected ? "streaming" : local.error ? "unavailable" : "connecting"}
        </StatusPill>
      }
    >
      <SettingsFactRows rows={localSystemRows(diagnostics, gpus, local.networkRates)} />
      <GpuSection
        metrics={realtime.metrics}
        gpus={gpus}
        currentProcess={realtime.status?.process ?? null}
        platformKind={realtime.platformKind}
      />
    </SettingsGroup>
  );
}

export function MachineSystemSettings({ node, target }: { node: RigNode; target?: LogsTarget }) {
  const remote = useMachineDiagnostics(target);
  const diagnostics = remote.diagnostics;
  const gpus = diagnostics?.gpus ?? [];
  return (
    <SettingsGroup
      title="Live system telemetry"
      description="Latest hardware telemetry reported by this machine."
      actions={
        <StatusPill tone={remote.error ? "danger" : diagnostics ? "good" : "info"}>
          {remote.error ? "unavailable" : diagnostics ? "streaming" : "connecting"}
        </StatusPill>
      }
    >
      <SettingsFactRows
        rows={[
          ...localSystemRows(diagnostics, gpus, remote.networkRates),
          { label: "Operating system", value: node.os ?? "Not reported" },
          { label: "Hostname", value: node.hostname ?? "Not reported", mono: true },
        ]}
      />
    </SettingsGroup>
  );
}
