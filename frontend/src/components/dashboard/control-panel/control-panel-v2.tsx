// CRITICAL
"use client";

import { useState } from "react";
import type { DashboardLayoutProps } from "../layout/dashboard-types";
import { StatusSection } from "./status-section";
import { GpuSection } from "./gpu-section";
import { createApiClient } from "@/lib/api/create-api-client";
import { setApiKey } from "@/lib/api-key";
import { getStoredBackendUrl, setStoredBackendUrl } from "@/lib/backend-url";
import { loadSavedControllers, type SavedController } from "@/lib/controllers";
import type { GPU, ProcessInfo } from "@/lib/types";
import { useLegacyEffect } from "@/hooks/agent/use-legacy-effects";

const CONTROLLER_POLL_REQUEST = { timeout: 4_000, retries: 0 } as const;

type ControllerSnapshot = SavedController & {
  index: number;
  primary: boolean;
  online: boolean;
  running: boolean;
  process: ProcessInfo | null;
  gpus: GPU[];
  inferencePort?: number;
  error?: string;
};

export function ControlPanel(props: DashboardLayoutProps) {
  const { currentProcess, currentRecipe, metrics, gpus, recipes } = props;

  // One continuous operator sheet. No outer card; section rhythm, hairlines,
  // compact telemetry, and quiet graph density do the work.
  return (
    <div className="mx-auto w-full max-w-[86rem] px-1 pt-2">
      <ControllerMatrix />
      <StatusSection
        currentProcess={currentProcess}
        currentRecipe={currentRecipe}
        metrics={metrics}
        gpus={gpus}
        isConnected={props.isConnected}
        platformKind={props.platformKind}
        inferencePort={props.inferencePort}
        onNavigateLogs={props.onNavigateLogs}
        onBenchmark={props.onBenchmark}
        benchmarking={props.benchmarking}
        recipes={recipes}
        lifecycleStatus={props.lifecycleStatus}
        onLaunch={props.onLaunch}
        onNewRecipe={props.onNewRecipe}
        onViewAll={props.onViewAll}
      />
      <GpuSection metrics={metrics} gpus={gpus} currentProcess={currentProcess} />
      <ActivityStrip {...props} />
    </div>
  );
}

function ControllerMatrix() {
  const [controllers, setControllers] = useState<SavedController[]>([]);
  const [snapshots, setSnapshots] = useState<ControllerSnapshot[]>([]);

  useLegacyEffect(() => {
    const load = () => {
      const primary = getStoredBackendUrl() || "http://127.0.0.1:8080";
      const extras = loadSavedControllers();
      const byUrl = new Map<string, SavedController>();
      byUrl.set(primary, { url: primary });
      for (const controller of extras) byUrl.set(controller.url, controller);
      setControllers([...byUrl.values()]);
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);

  useLegacyEffect(() => {
    if (controllers.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      const next = await Promise.all(
        controllers.map((controller, index) => pollController(controller, index)),
      );
      if (!cancelled) setSnapshots(next);
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [controllers]);

  if (controllers.length <= 1) return null;
  const rows = snapshots.length ? snapshots : controllers.map(pendingController);
  return (
    <section className="mb-3 border-b border-(--border)/35 pb-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          controllers live
        </div>
        <div className="text-[10.5px] text-(--dim)/70">
          {rows.filter((row) => row.online).length}/{rows.length} online
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((controller) => (
          <ControllerCard key={controller.url} controller={controller} />
        ))}
      </div>
    </section>
  );
}

async function pollController(
  controller: SavedController,
  index: number,
): Promise<ControllerSnapshot> {
  const api = createApiClient({
    baseUrl: "/api/proxy",
    useProxy: true,
    backendUrlOverride: controller.url,
    apiKeyOverride: controller.apiKey,
  });
  try {
    const [statusResult, gpuResult] = await Promise.allSettled([
      api.getStatus(CONTROLLER_POLL_REQUEST),
      api.getGPUs(CONTROLLER_POLL_REQUEST),
    ]);
    if (statusResult.status === "rejected") throw statusResult.reason;
    return {
      ...controller,
      index,
      primary: index === 0,
      online: true,
      running: statusResult.value.running,
      process: statusResult.value.process,
      inferencePort: statusResult.value.inference_port,
      gpus: gpuResult.status === "fulfilled" ? gpuResult.value.gpus : [],
    };
  } catch (error) {
    return {
      ...controller,
      index,
      primary: index === 0,
      online: false,
      running: false,
      process: null,
      gpus: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pendingController(controller: SavedController, index: number): ControllerSnapshot {
  return {
    ...controller,
    index,
    primary: index === 0,
    online: false,
    running: false,
    process: null,
    gpus: [],
  };
}

function ControllerCard({ controller }: { controller: ControllerSnapshot }) {
  const title = controller.primary ? "primary" : `controller ${controller.index + 1}`;
  const model =
    controller.process?.served_model_name || controller.process?.model_path || "no model";
  return (
    <div className="min-w-0 rounded-lg border border-(--border)/55 bg-(--surface)/50 px-3 py-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                controller.online ? "bg-(--hl2)" : "bg-(--err)"
              }`}
            />
            <span className="text-[12px] font-medium text-(--fg)">{title}</span>
            {controller.apiKey ? (
              <span className="rounded-full border border-(--hl2)/25 px-1.5 text-[9px] text-(--hl2)">
                key
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-(--dim)" title={controller.url}>
            {controller.url}
          </div>
        </div>
        {!controller.primary ? (
          <button
            type="button"
            onClick={() => {
              setStoredBackendUrl(controller.url);
              if (controller.apiKey) setApiKey(controller.apiKey);
            }}
            className="h-7 shrink-0 rounded-md px-2 text-[10.5px] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
            title="Use this controller for global actions"
          >
            make primary
          </button>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[10.5px]">
        <Metric
          label="state"
          value={controller.online ? (controller.running ? "running" : "idle") : "offline"}
        />
        <Metric label="gpus" value={String(controller.gpus.length)} />
        <Metric label="port" value={String(controller.inferencePort ?? "—")} />
      </div>
      <div className="mt-2 truncate text-[10.5px] text-(--dim)" title={controller.error ?? model}>
        {controller.online ? model : controller.error || "not reachable"}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-(--dim)/70">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-(--fg)">{value}</div>
    </div>
  );
}

function ActivityStrip({ logs }: DashboardLayoutProps) {
  const tail = logs.length > 0 ? logs.slice(-120) : [];

  return (
    <section className="border-t border-(--border)/40 px-2 pt-4 pb-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          Controller logs
        </div>
        <div className="text-[10.5px] text-(--dim)/70">{tail.length} lines</div>
      </div>
      <div className="max-h-[34rem] min-h-[18rem] overflow-y-auto border border-(--border)/45 bg-(--surface)/40 p-3 font-mono text-[10.5px] leading-5 text-(--dim)/80">
        {tail.length > 0 ? (
          tail.map((line, index) => (
            <div key={`${index}-${line}`} className="truncate">
              {trimLogLine(line)}
            </div>
          ))
        ) : (
          <div>0 log lines</div>
        )}
      </div>
    </section>
  );
}

function trimLogLine(line: string): string {
  return line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 180);
}
