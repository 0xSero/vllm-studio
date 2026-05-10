// CRITICAL
"use client";

import { formatDurationOrUnavailable } from "@/lib/formatters";
import { Timer, TrendingDown, TrendingUp } from "lucide-react";

interface LatencyStats {
  avg_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  min_ms?: number | null;
  max_ms?: number | null;
}

interface PerformanceStats {
  latency: LatencyStats;
  ttft: LatencyStats;
}

function MiniBar({
  value,
  max,
  colorClass = "bg-(--fg)/30",
}: {
  value: number | null;
  max: number;
  colorClass?: string;
}) {
  const percentage = Math.min(100, ((value ?? 0) / (max > 0 ? max : 1)) * 100);
  return (
    <div className="h-2 w-full border border-(--border) bg-(--bg)">
      <div className={`h-full ${colorClass}`} style={{ width: `${percentage}%` }} />
    </div>
  );
}

export function PerformanceDetails(stats: PerformanceStats) {
  const maxLatency = Math.max(
    stats.latency.avg_ms ?? 0,
    stats.latency.p95_ms ?? 0,
    stats.latency.p99_ms ?? 0,
  );
  const maxTTFT = Math.max(stats.ttft.avg_ms ?? 0, stats.ttft.p95_ms ?? 0, stats.ttft.p99_ms ?? 0);

  return (
    <div className="border border-(--border) bg-(--surface) overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-(--border) bg-(--bg)/55 px-4 py-4 text-(--dim) sm:px-6">
        <Timer className="h-4 w-4" />
        <span className="font-mono text-sm uppercase tracking-[0.3em]">Performance Metrics</span>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Latency Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-(--dim)">
              Latency Distribution
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--dim)">
              Lower is better
            </span>
          </div>

          <div className="space-y-3">
            {[
              { label: "Average", value: stats.latency.avg_ms, color: "bg-(--hl1)" },
              { label: "P50", value: stats.latency.p50_ms, color: "bg-(--hl2)" },
              { label: "P95", value: stats.latency.p95_ms, color: "bg-(--hl3)" },
              { label: "P99", value: stats.latency.p99_ms, color: "bg-(--err)" },
            ].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center justify-between font-mono text-sm">
                  <span className="text-(--dim)">{item.label}</span>
                  <span className="tabular-nums">{formatDurationOrUnavailable(item.value)}</span>
                </div>
                <MiniBar value={item.value} max={maxLatency} colorClass={item.color} />
              </div>
            ))}
          </div>

          {stats.latency.min_ms !== undefined && stats.latency.max_ms !== undefined && (
            <div className="mt-3 flex items-center justify-between border-t border-(--border) pt-3 font-mono text-xs text-(--dim)">
              <div className="flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                <span>Min: {formatDurationOrUnavailable(stats.latency.min_ms)}</span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                <span>Max: {formatDurationOrUnavailable(stats.latency.max_ms)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-(--border)" />

        {/* TTFT Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-(--dim)">
              Time to First Token
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--dim)">
              Lower is better
            </span>
          </div>

          <div className="space-y-3">
            {[
              { label: "Average", value: stats.ttft.avg_ms },
              { label: "P50", value: stats.ttft.p50_ms },
              { label: "P95", value: stats.ttft.p95_ms },
              { label: "P99", value: stats.ttft.p99_ms },
            ].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center justify-between font-mono text-sm">
                  <span className="text-(--dim)">{item.label}</span>
                  <span className="tabular-nums">{formatDurationOrUnavailable(item.value)}</span>
                </div>
                <MiniBar value={item.value} max={maxTTFT} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
