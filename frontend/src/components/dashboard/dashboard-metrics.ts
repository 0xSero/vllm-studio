import type { Metrics, ProcessInfo } from "@/lib/types";

function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1) || clean;
}

function norm(value: string | null | undefined): string | null {
  const next = value?.trim().toLowerCase();
  return next ? next : null;
}

function identitySet(values: Array<string | null | undefined>): Set<string> {
  const ids = values
    .flatMap((value) => [value, basename(value)])
    .map(norm)
    .filter((value): value is string => Boolean(value));
  return new Set(ids);
}

export function processMetricIds(process: ProcessInfo | null): Set<string> {
  if (!process) return new Set();
  return identitySet([process.served_model_name, process.model_path]);
}

function metricIds(metrics: Metrics): Set<string> {
  return identitySet([metrics.model_id, metrics.served_model_name, metrics.model_path]);
}

export function metricsBelongToProcess(
  metrics: Metrics | null,
  process: ProcessInfo | null,
): boolean {
  if (!metrics) return false;
  if (!process) return false;
  const ids = processMetricIds(process);
  if (ids.size === 0) return false;
  const idsFromMetrics = metricIds(metrics);
  if (idsFromMetrics.size === 0) return false;
  return [...idsFromMetrics].some((id) => ids.has(id));
}

export function scopedMetrics(
  metrics: Metrics | null,
  process: ProcessInfo | null,
): Metrics | null {
  return metricsBelongToProcess(metrics, process) ? metrics : null;
}
