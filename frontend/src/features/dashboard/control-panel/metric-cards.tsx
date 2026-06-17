"use client";

import type { ReactNode } from "react";
import type { GPU, Metrics } from "@/lib/types";

/**
 * Quiet ZCode-style metric cards: a row of `--color-card` tiles each with a
 * label, big value, and a sparkline in the usage-chart palette. Presentational
 * only — derives everything from props.
 */
export function MetricCards({ metrics, gpus }: { metrics: Metrics | null; gpus: GPU[] }) {
  const decode = metrics?.generation_throughput ?? 0;
  const vramUsed = totalVramUsedGb(gpus);
  const vramCap = totalVramCapGb(gpus);
  const vramPct = vramCap > 0 ? (vramUsed / vramCap) * 100 : 0;
  const avgUtil = avgGpuUtil(gpus);
  const activeGpus = gpus.length;

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <MetricCard
        label="Decode"
        value={fmt(decode)}
        unit="tok/s"
        accent="var(--color-usage-chart-1)"
        hint="Generation throughput"
      />
      <MetricCard
        label="VRAM"
        value={`${fmt(vramUsed)}/${fmt(vramCap, 0)}`}
        unit="GB"
        accent="var(--color-usage-chart-2)"
        hint={`${vramPct.toFixed(0)}% of capacity`}
        progress={vramPct}
      />
      <MetricCard
        label="GPU util"
        value={fmt(avgUtil)}
        unit="%"
        accent="var(--color-usage-chart-6)"
        hint={activeGpus > 0 ? `${activeGpus} GPU${activeGpus > 1 ? "s" : ""} avg` : "no GPUs"}
        progress={avgUtil}
      />
      <MetricCard
        label="Prefill"
        value={fmt(metrics?.prompt_throughput ?? 0)}
        unit="t/s"
        accent="var(--color-usage-chart-3)"
        hint="Prompt processing"
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  accent,
  hint,
  progress,
}: {
  label: string;
  value: string;
  unit: string;
  accent: string;
  hint?: string;
  progress?: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-(--color-card-border) bg-(--color-card) p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[length:var(--fs-xs)] font-medium text-(--color-foreground-subtle)">
          {label}
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[length:var(--fs-2xl)] font-semibold tracking-tight tabular-nums text-(--fg)">
          {value}
        </span>
        <span className="text-[length:var(--fs-xs)] text-(--color-foreground-subtle)">{unit}</span>
      </div>
      {hint ? (
        <div className="mt-1 text-[length:var(--fs-2xs)] text-(--color-foreground-subtlest)">
          {hint}
        </div>
      ) : null}
      {typeof progress === "number" && progress > 0 ? (
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-(--color-surface)">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, progress)}%`,
              backgroundColor: accent,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function fmt(n: number, decimals = 1): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toFixed(decimals);
}

function avgGpuUtil(gpus: GPU[]): number {
  if (gpus.length === 0) return 0;
  const sum = gpus.reduce((acc, g) => acc + (g.utilization_pct ?? g.utilization ?? 0), 0);
  return sum / gpus.length;
}

function totalVramUsedGb(gpus: GPU[]): number {
  return gpus.reduce((acc, g) => acc + toGb(g.memory_used, g.memory_used_mb), 0);
}

function totalVramCapGb(gpus: GPU[]): number {
  return gpus.reduce((acc, g) => acc + toGb(g.memory_total, g.memory_total_mb), 0);
}

function toGb(bytes?: number, mb?: number): number {
  if (typeof mb === "number" && Number.isFinite(mb)) return mb / 1024;
  if (typeof bytes === "number" && Number.isFinite(bytes)) return bytes / 1e9;
  return 0;
}
