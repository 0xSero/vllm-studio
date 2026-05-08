// CRITICAL
"use client";

import type { DashboardLayoutProps } from "../layout/dashboard-types";
import { StatusSection } from "./status-section";
import { GpuSection } from "./gpu-section";

export function ControlPanel(props: DashboardLayoutProps) {
  const { currentProcess, currentRecipe, metrics, gpus, recipes } = props;

  // One continuous operator sheet. No outer card; section rhythm, hairlines,
  // compact telemetry, and quiet graph density do the work.
  return (
    <div className="mx-auto w-full max-w-[86rem] px-1 pt-2">
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

function ActivityStrip({
  currentProcess,
  currentRecipe,
  metrics,
  logs,
  services,
  isConnected,
  inferencePort,
}: DashboardLayoutProps) {
  const serviceCounts = services?.reduce(
    (acc, service) => {
      const status = service.status.toLowerCase();
      if (status.includes("error") || status.includes("fail")) acc.errors += 1;
      else if (status.includes("running") || status.includes("ready") || status.includes("ok")) {
        acc.ready += 1;
      } else acc.other += 1;
      return acc;
    },
    { ready: 0, other: 0, errors: 0 },
  ) ?? { ready: 0, other: 0, errors: 0 };
  const context = currentRecipe?.max_model_len ? formatCompact(currentRecipe.max_model_len) : "0";
  const pending = metrics?.pending_requests ?? 0;
  const clients = metrics?.running_requests ?? 0;
  const tail = logs.length > 0 ? logs.slice(-3) : [];

  return (
    <section className="border-t border-(--border)/40 px-2 pt-4 pb-5">
      <div className="grid gap-x-10 gap-y-4 lg:grid-cols-3">
        <ActivityColumn title="Session">
          <ActivityRow label="endpoint" value="/v1/chat/completions" />
          <ActivityRow label="clients" value={String(clients)} extra={`queued ${pending}`} />
          <ActivityRow label="queued" value={String(pending)} />
          <ActivityRow label="uptime" value="0" />
          <ActivityRow label="context" value={context} />
          <ActivityRow
            label="routing"
            value={currentProcess ? `:${inferencePort ?? currentProcess.port}` : "standby"}
          />
        </ActivityColumn>
        <ActivityColumn title="Agents">
          <ActivityRow label="vllm-studio" value="~/work/vllm-studio" extra="running ■" />
          <ActivityRow label="autoresearch" value="~/work/autoresearch" extra="idle ■" />
          <ActivityRow label="benchmark" value="~/work/benchmark" extra="paused ‖" />
        </ActivityColumn>
        <ActivityColumn title="Health">
          <ActivityRow label="controller" value={isConnected ? "ok" : "offline"} />
          <ActivityRow label="proxy" value={currentProcess ? "ready" : "idle"} extra="ready" />
          <ActivityRow label="SQLite" value="data/vllm_studio.db" extra="ok" />
          <ActivityRow label="desktop" value="vLLM Studio.app" extra="current" />
        </ActivityColumn>
      </div>

      <div className="mt-5 border-t border-(--border)/25 pt-2 font-mono text-[10.5px] leading-5 text-(--dim)/70">
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

function ActivityColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ActivityRow({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 font-mono text-[11px] tabular-nums">
      <span className="w-16 shrink-0 text-[9.5px] uppercase tracking-[0.14em] text-(--dim)/55">
        {label}
      </span>
      <span className="min-w-0 truncate text-(--fg)/82">{value}</span>
      {extra ? <span className="truncate text-(--dim)/60">{extra}</span> : null}
    </div>
  );
}

function formatCompact(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function trimLogLine(line: string): string {
  return line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 180);
}
