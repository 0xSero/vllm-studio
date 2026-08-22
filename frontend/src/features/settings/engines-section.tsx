"use client";

import { effectInterval, effectTimeout } from "@/lib/effect-timers";

import { useCallback, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ArrowUpCircle, Check, XCircle } from "@/ui/icon-registry";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import type { EngineJob, RuntimeBackendInfo, RuntimeTarget, SystemRuntimeInfo } from "@/lib/types";
import { StatusPill, Spinner } from "@/ui";
import { SettingsGroup, SettingsNotice } from "./settings-ui";
import {
  DataRow,
  DetailRow,
  EndCell,
  HeadCell,
  GroupRow,
  IdentityCell,
  RowAction,
  StatusText,
  TableFrame,
  TextCell,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import {
  ENGINE_META,
  MANAGED_RUNTIME_BACKENDS,
  ENGINE_TABLE_COLSPAN,
  ENGINE_TABLE_COLUMNS,
  ENGINE_TABLE_MIN_WIDTH,
  ManagedRuntimeInstallRows,
  RuntimeTargetRows,
  RuntimeTargetStatus,
  isManagedRuntimeTarget,
  isRunningEngineJob,
  type ManagedRuntimeInstallBackend,
} from "./runtime-targets";

type UpgradeState = { status: "idle" | "upgrading" | "success" | "error"; message?: string };

const FALLBACK_ENGINES = ["vllm", "sglang", "llamacpp", "mlx"] as const;

type EngineRowsView =
  | { kind: "backends"; rows: Array<{ id: string; info: RuntimeBackendInfo }> }
  | { kind: "pending"; engineIds: readonly string[] }
  | { kind: "targets"; targets: RuntimeTarget[] };

/** Which engine rows the settings page should render, given what has hydrated. */
function resolveEngineRowsView(
  targets: RuntimeTarget[],
  backends: SystemRuntimeInfo["backends"] | undefined,
): EngineRowsView {
  const inferenceTargets = targets.filter((target) =>
    FALLBACK_ENGINES.includes(target.backend as (typeof FALLBACK_ENGINES)[number]),
  );
  if (inferenceTargets.length > 0) {
    return { kind: "targets", targets: inferenceTargets };
  }
  if (backends) {
    return {
      kind: "backends",
      rows: FALLBACK_ENGINES.flatMap((id) => {
        const info = backends[id];
        return info ? [{ id, info }] : [];
      }),
    };
  }
  return { kind: "pending", engineIds: FALLBACK_ENGINES };
}

const UPGRADE_ICONS: Record<UpgradeState["status"], ReactNode> = {
  idle: <ArrowUpCircle className="h-3 w-3" />,
  upgrading: <Spinner size="xs" />,
  success: <Check className="h-3 w-3 text-(--ok)" />,
  error: <XCircle className="h-3 w-3 text-(--err)" />,
};

export function EnginesSection({ runtime }: { runtime?: SystemRuntimeInfo | null }) {
  const { runtimeSummary, status, lease } = useRealtimeStatusStore();
  const [targets, setTargets] = useState<RuntimeTarget[]>([]);
  const [jobs, setJobs] = useState<EngineJob[]>([]);
  const [lostJobNotice, setLostJobNotice] = useState<string | null>(null);
  const knownJobsRef = useRef<EngineJob[]>([]);

  const backends = runtime?.backends ?? runtimeSummary?.backends;
  const gpuMon = runtime?.gpu_monitoring ?? runtimeSummary?.gpu_monitoring;
  const activeBackend = status?.process?.backend;

  const refreshRuntimeJobs = useCallback(async () => {
    // Keep the last known payloads on fetch failure: wiping to [] would make a
    // transient network blip indistinguishable from a controller restart.
    const [targetPayload, jobPayload] = await Promise.all([
      api.getRuntimeTargets().catch(() => null),
      api.getRuntimeJobs().catch(() => null),
    ]);
    if (targetPayload) {
      setTargets(targetPayload.targets);
    }
    if (!jobPayload) return;
    // Runtime jobs live in controller memory: a running job vanishing from a
    // successful poll means the controller restarted and the install died.
    const lostJob = knownJobsRef.current.find(
      (job) =>
        isRunningEngineJob(job) && !jobPayload.jobs.some((candidate) => candidate.id === job.id),
    );
    if (lostJob) {
      setLostJobNotice(
        `The controller restarted while the ${lostJob.backend} ${lostJob.type} job was running, ` +
          "so the job was lost. Re-run the install.",
      );
    } else if (jobPayload.jobs.some((job) => isRunningEngineJob(job))) {
      setLostJobNotice(null);
    }
    knownJobsRef.current = jobPayload.jobs;
    setJobs(jobPayload.jobs);
  }, []);

  useMountSubscription(() => {
    void Promise.resolve().then(refreshRuntimeJobs);
    const jobTimer = effectInterval(() => void refreshRuntimeJobs(), 2500);
    return () => jobTimer.cancel();
  }, [refreshRuntimeJobs]);

  const engineRows = useMemo(() => resolveEngineRowsView(targets, backends), [backends, targets]);
  const hasRows = engineRows.kind !== "pending";

  return (
    <div>
      <SettingsGroup
        title="Runtime engines"
        description="Install, update, and inspect the model-serving runtimes on this controller."
        actions={<HydrationStatus hasRows={hasRows} />}
        collapsible
        defaultOpen={false}
      >
        {lostJobNotice ? (
          <SettingsNotice tone="warning" className="m-3">
            {lostJobNotice}
          </SettingsNotice>
        ) : null}
        <TableFrame minWidthClass={ENGINE_TABLE_MIN_WIDTH}>
          <thead>
            <tr>
              {ENGINE_TABLE_COLUMNS.map((column, index) => (
                <HeadCell key={column} numeric={index === ENGINE_TABLE_COLUMNS.length - 1}>
                  {column}
                </HeadCell>
              ))}
            </tr>
          </thead>
          <tbody>
            <EngineRows
              activeBackend={activeBackend}
              jobs={jobs}
              onJobCreated={refreshRuntimeJobs}
              view={engineRows}
            />
            <GroupRow
              colSpan={ENGINE_TABLE_COLSPAN}
              label="Host"
              blurb="What the controller can see of this machine's GPUs."
            />
            {hostRows(gpuMon, lease?.holder).map((row) => (
              <HostRow key={row.label} {...row} />
            ))}
          </tbody>
        </TableFrame>
      </SettingsGroup>
    </div>
  );
}

function HydrationStatus({ hasRows }: { hasRows: boolean }) {
  // Nothing to announce once the data is in — the rows speak for themselves, and
  // the page header already shows controller sync. Only surface a quiet hint
  // while the first payload is still loading.
  if (hasRows) return null;
  return <StatusPill tone="info">Loading…</StatusPill>;
}

/** A host fact: one value and one verdict, with no location column to fill. */
type HostRowProps = {
  label: string;
  description: string;
  value: string;
  tone: ComponentProps<typeof StatusText>["tone"];
  state: string;
};

function hostRows(
  gpuMon: SystemRuntimeInfo["gpu_monitoring"] | undefined,
  holder: string | null | undefined,
): HostRowProps[] {
  const monitoring = Boolean(gpuMon?.available);
  return [
    {
      label: "GPU monitoring",
      description: "nvidia-smi, amd-smi, rocm-smi, or Intel sysfs discovery from the controller.",
      value: monitoring ? (gpuMon?.tool ?? "available") : "not available yet",
      tone: monitoring ? "ok" : "warn",
      state: monitoring ? "online" : "fallback",
    },
    {
      label: "GPU lease",
      description: "Current runtime lock holder when a launch or engine job owns the GPU lane.",
      value: holder ?? "No active lease",
      tone: holder ? "info" : "dim",
      state: holder ? "held" : "free",
    },
  ];
}

function HostRow({ label, description, value, tone, state }: HostRowProps) {
  return (
    <DataRow>
      <IdentityCell label={label} description={description} />
      <TextCell mono>{value}</TextCell>
      <TextCell>—</TextCell>
      <EndCell>
        <StatusText tone={tone}>{state}</StatusText>
      </EndCell>
    </DataRow>
  );
}

function EngineRows({
  activeBackend,
  jobs,
  onJobCreated,
  view,
}: {
  activeBackend?: string;
  jobs: EngineJob[];
  onJobCreated: () => Promise<void>;
  view: EngineRowsView;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const runJob = useCallback(
    async (payload: {
      backend: EngineJob["backend"];
      targetId?: string;
      type: "install" | "update";
    }) => {
      setActionError(null);
      try {
        await api.createRuntimeJob(payload);
        await onJobCreated();
      } catch (err) {
        const reason = err instanceof Error ? err.message : "request failed";
        setActionError(`Could not start the ${payload.backend} ${payload.type}: ${reason}`);
      }
    },
    [onJobCreated],
  );
  const handleTargetAction = useCallback(
    (target: RuntimeTarget) =>
      runJob({
        backend: target.backend,
        targetId: target.id,
        type: target.installed ? "update" : "install",
      }),
    [runJob],
  );
  const handleManagedInstall = useCallback(
    (backend: ManagedRuntimeInstallBackend) => runJob({ backend, type: "install" }),
    [runJob],
  );

  if (view.kind === "targets") {
    const discoveredTargets = view.targets.filter((target) => !isManagedRuntimeTarget(target));
    return (
      <>
        {actionError ? (
          <DetailRow colSpan={ENGINE_TABLE_COLSPAN}>
            <span className="text-(--err)">{actionError}</span>
          </DetailRow>
        ) : null}
        <GroupRow
          colSpan={ENGINE_TABLE_COLSPAN}
          label="Managed environments"
          blurb="Python environments the controller creates and updates itself."
        />
        <ManagedRuntimeInstallRows
          backends={MANAGED_RUNTIME_BACKENDS}
          targets={view.targets}
          jobs={jobs}
          onInstall={handleManagedInstall}
          onUpdateTarget={handleTargetAction}
        />
        {discoveredTargets.length > 0 ? (
          <>
            <GroupRow
              colSpan={ENGINE_TABLE_COLSPAN}
              label="Discovered runtimes"
              blurb="Installs found on this machine that the controller did not create."
            />
            <RuntimeTargetRows
              targets={discoveredTargets}
              jobs={jobs}
              onAction={handleTargetAction}
            />
          </>
        ) : null}
      </>
    );
  }
  if (view.kind === "backends") {
    return view.rows.map(({ id, info }) => (
      <BackendRow key={id} id={id} info={info} active={activeBackend === id} />
    ));
  }
  return view.engineIds.map((key) => (
    <DataRow key={key}>
      <IdentityCell label={ENGINE_META[key].label} description={ENGINE_META[key].description} />
      <TextCell>Runtime data has not hydrated yet.</TextCell>
      <TextCell>—</TextCell>
      <EndCell>
        <StatusText tone="info">pending</StatusText>
      </EndCell>
    </DataRow>
  ));
}

function BackendRow({
  id,
  info,
  active,
}: {
  id: string;
  info: RuntimeBackendInfo;
  active?: boolean;
}) {
  const meta = ENGINE_META[id] ?? { label: id, description: "Runtime backend" };
  const [state, setState] = useState<UpgradeState>({ status: "idle" });
  const onUpgrade = upgradeHandler(id);
  const location = info.python_path ?? info.binary_path ?? "";

  const handleUpgrade = useCallback(async () => {
    if (!onUpgrade) return;
    setState({ status: "upgrading" });
    try {
      await onUpgrade();
      setState({ status: "success", message: "Upgrade complete" });
      effectTimeout(() => setState({ status: "idle" }), 4000);
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Upgrade failed" });
      effectTimeout(() => setState({ status: "idle" }), 6000);
    }
  }, [onUpgrade]);

  return (
    <>
      <DataRow>
        <IdentityCell label={meta.label} description={meta.description} />
        <TextCell mono>{info.installed ? (info.version ?? "installed") : "not installed"}</TextCell>
        <TextCell mono title={location || undefined}>
          {location || "—"}
        </TextCell>
        <EndCell>
          <div className="flex items-center justify-end gap-2">
            <RuntimeTargetStatus installed={info.installed} active={active} />
            {onUpgrade && info.upgrade_command_available ? (
              <RowAction
                alwaysVisible
                onClick={() => void handleUpgrade()}
                disabled={state.status === "upgrading"}
                title={`${info.installed ? "Update" : "Install"} ${meta.label}`}
              >
                {UPGRADE_ICONS[state.status]}
                {state.status === "idle" ? (info.installed ? "Update" : "Install") : state.status}
              </RowAction>
            ) : null}
          </div>
        </EndCell>
      </DataRow>
      {state.status === "error" && state.message ? (
        <DetailRow colSpan={ENGINE_TABLE_COLSPAN}>
          <span className="text-(--err)">{state.message}</span>
        </DetailRow>
      ) : null}
    </>
  );
}

function upgradeHandler(id: string) {
  if (id === "vllm" || id === "sglang" || id === "llamacpp") return () => api.upgradeRuntime(id);
  return undefined;
}
