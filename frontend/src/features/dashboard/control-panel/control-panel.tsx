"use client";

import type { DashboardLayoutProps } from "../layout/dashboard-types";
import { StatusSection } from "./status-section";
import { useApiUrlCensored } from "@/ui/api-url-censor";
import {
  activateController,
  useControllerMatrixStore,
  type ControllerSnapshot,
} from "./controller-matrix-store";

const DOT_BY_STATE: Record<string, string> = {
  auth: "bg-(--hl3)",
  running: "bg-(--hl2)",
  idle: "bg-(--dim)",
  offline: "bg-(--err)",
};

export function ControlPanel(props: DashboardLayoutProps) {
  const { currentProcess, currentRecipe, metrics, gpus, recipes } = props;

  return (
    <div className="mx-auto w-full max-w-[86rem] px-1 pt-1">
      <ControllerMatrix />
      <StatusSection
        currentProcess={currentProcess}
        currentRecipe={currentRecipe}
        metrics={metrics}
        metricsDetached={props.metricsDetached}
        gpus={gpus}
        isConnected={props.isConnected}
        isStatusLoading={props.isStatusLoading}
        platformKind={props.platformKind}
        inferencePort={props.inferencePort}
        onBenchmark={props.onBenchmark}
        benchmarking={props.benchmarking}
        benchmarkResult={props.benchmarkResult}
        recipes={recipes}
        lifecycleStatus={props.lifecycleStatus}
        lifecycleError={props.lifecycleError}
        onLaunch={props.onLaunch}
        onNewRecipe={props.onNewRecipe}
        onViewAll={props.onViewAll}
      />
    </div>
  );
}

function ControllerMatrix() {
  const { rows, activeUrl, visible } = useControllerMatrixStore();
  if (!visible) return null;
  return (
    <section className="mb-2 border-b border-(--separator) pb-2">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="text-[length:var(--fs-sm)] font-medium text-(--hl2)">controllers live</div>
        <div className="text-[length:var(--fs-xs)] text-(--dim)/70">
          {rows.filter((row) => row.online).length}/{rows.length} online
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {rows.map((controller) => (
          <ControllerTab
            key={controller.url}
            controller={controller}
            active={controller.url === activeUrl}
            onActivate={() => activateController(controller)}
          />
        ))}
      </div>
    </section>
  );
}

function ControllerTab({
  controller,
  active,
  onActivate,
}: {
  controller: ControllerSnapshot;
  active: boolean;
  onActivate: () => void;
}) {
  const censorUrls = useApiUrlCensored();
  const fallback = controller.primary ? "primary" : `controller ${controller.index + 1}`;
  const label = controller.name?.trim() || fallback;
  const state = controller.authRequired
    ? "auth"
    : controller.online
      ? controller.running
        ? "running"
        : "idle"
      : "offline";
  return (
    <button
      type="button"
      onClick={onActivate}
      title={censorUrls ? "Controller URL censored" : controller.url}
      className={`group inline-flex h-7 min-w-0 max-w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-2 text-left text-[length:var(--fs-sm)] transition ${
        active
          ? "border-(--accent)/60 bg-(--accent)/10 text-(--fg)"
          : "border-(--border)/55 bg-(--surface)/40 text-(--dim) hover:border-(--border) hover:text-(--fg)"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_BY_STATE[state]}`} aria-hidden />
      <span className="max-w-[10rem] truncate font-medium text-(--fg)">{label}</span>
      {controller.modelName ? (
        <span className="max-w-[14rem] truncate text-(--dim)">{controller.modelName}</span>
      ) : null}
      <span className="text-[length:var(--fs-sm)] text-(--hl2)">{state}</span>
    </button>
  );
}
