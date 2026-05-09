// CRITICAL
"use client";

import { useEffect, useState } from "react";
import type { DashboardLayoutProps } from "../layout/dashboard-types";
import { StatusSection } from "./status-section";
import { GpuSection } from "./gpu-section";
import { getStoredBackendUrl, setStoredBackendUrl } from "@/lib/backend-url";

export function ControlPanel(props: DashboardLayoutProps) {
  const { currentProcess, currentRecipe, metrics, gpus, recipes } = props;

  // One continuous operator sheet. No outer card; section rhythm, hairlines,
  // compact telemetry, and quiet graph density do the work.
  return (
    <div className="mx-auto w-full max-w-[86rem] px-1 pt-2">
      <ControllerTabs />
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

function ControllerTabs() {
  const [controllers, setControllers] = useState<string[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const load = () => {
      const primary = getStoredBackendUrl() || "http://127.0.0.1:8080";
      let extras: string[] = [];
      try {
        const raw = window.localStorage.getItem("vllm-studio.controllers");
        extras = raw ? (JSON.parse(raw) as string[]) : [];
      } catch {
        extras = [];
      }
      setActive(primary);
      setControllers([...new Set([primary, ...extras].map((url) => url.trim()).filter(Boolean))]);
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);

  if (controllers.length <= 1) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-(--border)/35 pb-2">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.16em] text-(--dim)">
        controllers
      </span>
      {controllers.map((url, index) => (
        <button
          key={url}
          type="button"
          onClick={() => {
            setStoredBackendUrl(url);
            window.location.reload();
          }}
          className={`h-7 rounded-md px-2 text-[11px] ${
            url === active
              ? "bg-(--active) text-(--fg)"
              : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          }`}
          title={url}
        >
          {index === 0 ? "primary" : `controller ${index + 1}`}
        </button>
      ))}
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
