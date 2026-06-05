"use client";

import { useMemo, useRef } from "react";
import type { MetricSampleInput } from "./status-section-view";

type MetricSample = {
  at: number;
  generation: number;
  prefill: number;
  requests: number;
  ttft: number;
};

export function useMetricSamples({
  key,
  generation,
  prefill,
  ttft,
  requests,
  active,
}: MetricSampleInput) {
  const samplesRef = useRef<MetricSample[]>([]);
  const sampleKeyRef = useRef<string | null>(null);

  if (sampleKeyRef.current !== key) {
    sampleKeyRef.current = key;
    samplesRef.current = [];
  }
  if (!active) return zeroSamples();

  const next: MetricSample = {
    at: Date.now(),
    generation: finitePositive(generation),
    prefill: finitePositive(prefill),
    requests: finitePositive(requests),
    ttft: finitePositive(ttft),
  };
  const current = samplesRef.current;
  const previous = current[current.length - 1];
  if (
    !previous ||
    previous.generation !== next.generation ||
    previous.prefill !== next.prefill ||
    previous.ttft !== next.ttft ||
    previous.requests !== next.requests
  ) {
    samplesRef.current = [...current, next].slice(-56);
  }

  return samplesRef.current.length > 0 ? samplesRef.current : zeroSamples();
}

export function MetricTrends({ samples }: { samples: MetricSample[] }) {
  return (
    <div className="mt-6 border-t border-(--border)/40 pt-3">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <TrendPanel
          label="Throughput (tok/s)"
          meta="Last 30 minutes"
          lines={[
            { values: samples.map((sample) => sample.prefill), className: "text-(--fg)/80" },
            { values: samples.map((sample) => sample.generation), className: "text-(--dim)/35" },
          ]}
        />
        <TrendPanel
          label="TTFT (ms) & requests"
          meta="Last 30 minutes"
          lines={[
            { values: samples.map((sample) => sample.ttft), className: "text-(--fg)/80" },
            { values: samples.map((sample) => sample.requests), className: "text-(--dim)/35" },
          ]}
        />
      </div>
    </div>
  );
}

function TrendPanel({
  label,
  meta,
  lines,
}: {
  label: string;
  meta: string;
  lines: Array<{ values: number[]; className: string }>;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.18em] text-(--dim)/75">
          {label}
        </span>
        <span className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.14em] text-(--dim)/45">
          {meta}
        </span>
      </div>
      <div className="h-28">
        <Sparkline lines={lines} />
      </div>
    </div>
  );
}

function Sparkline({ lines }: { lines: Array<{ values: number[]; className: string }> }) {
  const paths = useMemo(() => {
    const all = lines.flatMap((line) => line.values).filter((value) => Number.isFinite(value));
    const max = Math.max(1, ...all);
    return lines.map((line) => ({ ...line, points: toPolyline(line.values, max) }));
  }, [lines]);

  return (
    <svg
      className="h-full w-full overflow-visible text-(--border)"
      viewBox="0 0 320 96"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d="M0 16H320 M0 48H320 M0 80H320"
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="0.6"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M0 95.5H320"
        stroke="currentColor"
        strokeOpacity="0.75"
        strokeWidth="0.7"
        vectorEffect="non-scaling-stroke"
      />
      {paths.map((line, index) => (
        <polyline
          key={index}
          points={line.points}
          fill="none"
          className={line.className}
          stroke="currentColor"
          strokeWidth={index === 0 ? 1.6 : 1.1}
          strokeLinecap="square"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function toPolyline(values: number[], max: number): string {
  const padded = values.length >= 2 ? values : [0, ...values];
  const width = 320;
  const height = 92;
  const last = Math.max(1, padded.length - 1);
  return padded
    .map((value, index) => {
      const x = (index / last) * width;
      const y = 94 - (Math.max(0, value) / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function zeroSamples(): MetricSample[] {
  return Array.from({ length: 34 }, (_, index) => ({
    at: Date.now() - (34 - index) * 52_000,
    generation: 0,
    prefill: 0,
    requests: 0,
    ttft: 0,
  }));
}
