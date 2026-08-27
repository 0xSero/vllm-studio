import type { GpuInfo } from "../../models/types";
import { Effect, Option, Schema } from "effect";
import { runCommandAsyncEffect } from "../../../core/command";
import { resolveAmdSmiBinary, resolveRocmSmiBinary } from "./smi-tools";

const AmdSmiValueSchema = Schema.Union([
  Schema.Struct({
    value: Schema.optional(Schema.Number),
    unit: Schema.optional(Schema.String),
  }),
  Schema.Literal("N/A"),
  Schema.Null,
]);

type AmdSmiValue =
  | { readonly value?: number | undefined; readonly unit?: string | undefined }
  | "N/A"
  | null;

const AmdSmiMetricGpuSchema = Schema.Struct({
  gpu: Schema.optional(Schema.Number),
  mem_usage: Schema.optional(
    Schema.Struct({
      total_vram: Schema.optional(AmdSmiValueSchema),
      used_vram: Schema.optional(AmdSmiValueSchema),
      free_vram: Schema.optional(AmdSmiValueSchema),
    }),
  ),
  usage: Schema.optional(Schema.Struct({ gfx_activity: Schema.optional(AmdSmiValueSchema) })),
  temperature: Schema.optional(
    Schema.Struct({
      hotspot: Schema.optional(AmdSmiValueSchema),
      edge: Schema.optional(AmdSmiValueSchema),
    }),
  ),
  power: Schema.optional(Schema.Struct({ socket_power: Schema.optional(AmdSmiValueSchema) })),
});

interface AmdSmiMetricGpu {
  readonly gpu?: number | undefined;
  readonly mem_usage?:
    | {
        readonly total_vram?: AmdSmiValue | undefined;
        readonly used_vram?: AmdSmiValue | undefined;
        readonly free_vram?: AmdSmiValue | undefined;
      }
    | undefined;
  readonly usage?: { readonly gfx_activity?: AmdSmiValue | undefined } | undefined;
  readonly temperature?:
    | { readonly hotspot?: AmdSmiValue | undefined; readonly edge?: AmdSmiValue | undefined }
    | undefined;
  readonly power?: { readonly socket_power?: AmdSmiValue | undefined } | undefined;
}

const AmdSmiStaticGpuSchema = Schema.Struct({
  gpu: Schema.optional(Schema.Number),
  asic: Schema.optional(Schema.Struct({ market_name: Schema.optional(Schema.String) })),
});

interface AmdSmiStaticGpu {
  readonly gpu?: number | undefined;
  readonly asic?: { readonly market_name?: string | undefined } | undefined;
}

type RocmSmiParsed = {
  index: number;
  name: string;
  memory_total_bytes: number | null;
  memory_used_bytes: number | null;
  utilization_pct: number | null;
  temp_c: number | null;
  power_draw_w: number | null;
  power_limit_w: number | null;
};

const readAmdSmiValueMb = (value: AmdSmiValue | undefined): number | null => {
  if (!value || value === "N/A") return null;
  const rawValue = value.value;
  if (rawValue === undefined || !Number.isFinite(rawValue)) return null;
  const unit = value.unit?.toLowerCase() ?? "";
  if (!unit || unit === "mb" || unit === "mib") return rawValue;
  if (unit === "gb" || unit === "gib") return rawValue * 1024;
  return rawValue;
};

const readAmdSmiValueNumber = (value: AmdSmiValue | undefined): number | null => {
  if (!value || value === "N/A" || value.value === undefined) return null;
  return Number.isFinite(value.value) ? value.value : null;
};

export const parseAmdSmiMetricJson = (jsonText: string): AmdSmiMetricGpu[] => {
  try {
    const schema = Schema.Struct({ gpu_data: Schema.Array(AmdSmiMetricGpuSchema) });
    const decoded = Schema.decodeUnknownOption(schema)(JSON.parse(jsonText));
    return Option.isSome(decoded) ? [...decoded.value.gpu_data] : [];
  } catch {
    return [];
  }
};

export const parseAmdSmiStaticJson = (jsonText: string): AmdSmiStaticGpu[] => {
  try {
    const schema = Schema.Struct({ gpu_data: Schema.Array(AmdSmiStaticGpuSchema) });
    const decoded = Schema.decodeUnknownOption(schema)(JSON.parse(jsonText));
    return Option.isSome(decoded) ? [...decoded.value.gpu_data] : [];
  } catch {
    return [];
  }
};

const parseRocmSmiValue = (raw: string): { value: number; unit: string } | null => {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z%]+)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: (match[2] ?? "").trim() };
};

const rocmSmiToBytes = (parsed: { value: number; unit: string } | null): number | null => {
  if (!parsed) return null;
  const unit = parsed.unit.toLowerCase();
  if (!unit || unit === "b") return Math.round(parsed.value);
  if (unit === "kb" || unit === "kib") return Math.round(parsed.value * 1024);
  if (unit === "mb" || unit === "mib") return Math.round(parsed.value * 1024 ** 2);
  if (unit === "gb" || unit === "gib") return Math.round(parsed.value * 1024 ** 3);
  if (unit === "tb" || unit === "tib") return Math.round(parsed.value * 1024 ** 4);
  return null;
};

const enrichUnitFromLabel = (
  parsed: { value: number; unit: string } | null,
  label: string,
): { value: number; unit: string } | null => {
  if (!parsed) return null;
  if (parsed.unit) return parsed;
  const match = label.match(/\((kib|mib|gib|tib|kb|mb|gb|tb|b)\)/i);
  if (!match) return parsed;
  return { ...parsed, unit: match[1] ?? "" };
};

const isCardSeriesLabel = (label: string, entry: RocmSmiParsed): boolean =>
  label.includes("card series") && entry.name === "AMD GPU";
const isTemperatureLabel = (label: string): boolean =>
  label.includes("temperature") && label.includes("(c)");
const isAveragePowerLabel = (label: string): boolean =>
  label.includes("average") && label.includes("power") && label.includes("(w)");
const isPowerLimitLabel = (label: string): boolean =>
  (label.includes("power cap") || label.includes("max")) && label.includes("(w)");

const rocmSmiPowerField = (label: string): "power_draw_w" | "power_limit_w" | null => {
  if (isAveragePowerLabel(label)) return "power_draw_w";
  if (isPowerLimitLabel(label)) return "power_limit_w";
  return null;
};

const updateRocmSmiEntry = (entry: RocmSmiParsed, label: string, valueText: string): void => {
  if (label.includes("card model") || isCardSeriesLabel(label, entry)) {
    entry.name = valueText;
    return;
  }
  if (label.includes("total vram")) {
    entry.memory_total_bytes = rocmSmiToBytes(
      enrichUnitFromLabel(parseRocmSmiValue(valueText), label),
    );
    return;
  }
  if (label.includes("used vram")) {
    entry.memory_used_bytes = rocmSmiToBytes(
      enrichUnitFromLabel(parseRocmSmiValue(valueText), label),
    );
    return;
  }
  if (label.includes("gpu use")) {
    entry.utilization_pct = parseRocmSmiValue(valueText.replace("%", "").trim())?.value ?? null;
    return;
  }
  if (isTemperatureLabel(label)) {
    entry.temp_c = parseRocmSmiValue(valueText.replace(/c$/i, "").trim())?.value ?? null;
    return;
  }
  const powerField = rocmSmiPowerField(label);
  if (powerField) {
    entry[powerField] = parseRocmSmiValue(valueText.replace(/w$/i, "").trim())?.value ?? null;
  }
};

const emptyRocmSmiEntry = (index: number): RocmSmiParsed => ({
  index,
  name: "AMD GPU",
  memory_total_bytes: null,
  memory_used_bytes: null,
  utilization_pct: null,
  temp_c: null,
  power_draw_w: null,
  power_limit_w: null,
});

export const parseRocmSmiText = (text: string): RocmSmiParsed[] => {
  const byIndex = new Map<number, RocmSmiParsed>();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const match = line.match(/GPU\[(\d+)\]\s*:\s*([^:]+?)\s*:\s*(.*)$/i);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isFinite(index)) continue;
    const entry = byIndex.get(index) ?? emptyRocmSmiEntry(index);
    updateRocmSmiEntry(entry, (match[2] ?? "").trim().toLowerCase(), (match[3] ?? "").trim());
    byIndex.set(index, entry);
  }
  return [...byIndex.values()].sort((first, second) => first.index - second.index);
};

const amdMetricToGpuInfo = (
  metric: AmdSmiMetricGpu,
  staticByGpu: ReadonlyMap<number, AmdSmiStaticGpu>,
): GpuInfo | null => {
  const index = metric.gpu;
  if (index === undefined) return null;
  const name = staticByGpu.get(index)?.asic?.market_name ?? "AMD GPU";
  const totalMb = Number(readAmdSmiValueMb(metric.mem_usage?.total_vram));
  const usedMb = Number(readAmdSmiValueMb(metric.mem_usage?.used_vram));
  const freeMb = readAmdSmiValueMb(metric.mem_usage?.free_vram) ?? Math.max(0, totalMb - usedMb);
  return {
    index,
    name,
    memory_total_mb: Math.max(0, Math.round(totalMb)),
    memory_used_mb: Math.max(0, Math.round(usedMb)),
    memory_free_mb: Math.max(0, Math.round(freeMb)),
    utilization_pct: Math.max(
      0,
      Math.round(Number(readAmdSmiValueNumber(metric.usage?.gfx_activity))),
    ),
    temp_c: Math.max(
      0,
      Math.round(
        readAmdSmiValueNumber(metric.temperature?.hotspot) ??
          readAmdSmiValueNumber(metric.temperature?.edge) ??
          0,
      ),
    ),
    power_draw: Math.max(0, Number(readAmdSmiValueNumber(metric.power?.socket_power))),
    power_limit: 0,
  };
};

export const getGpuInfoFromAmdSmi = (): Effect.Effect<GpuInfo[]> =>
  Effect.gen(function* () {
    const amdSmi = resolveAmdSmiBinary();
    if (!amdSmi) return [];

    const metricResult = yield* runCommandAsyncEffect(amdSmi, ["metric", "--json", "-g", "all"], {
      timeoutMs: 5_000,
    });
    if (metricResult.status !== 0 || !metricResult.stdout) return [];

    const staticResult = yield* runCommandAsyncEffect(amdSmi, ["static", "--json", "-g", "all"], {
      timeoutMs: 5_000,
    });
    if (staticResult.status !== 0 || !staticResult.stdout) return [];

    const metrics = parseAmdSmiMetricJson(metricResult.stdout);
    const statics = parseAmdSmiStaticJson(staticResult.stdout);
    const staticByGpu = new Map<number, AmdSmiStaticGpu>();

    for (const entry of statics) {
      const index = entry.gpu ?? null;
      if (index !== null) {
        staticByGpu.set(index, entry);
      }
    }

    return metrics
      .map((metric) => amdMetricToGpuInfo(metric, staticByGpu))
      .filter((entry): entry is GpuInfo => entry !== null);
  });

export const getGpuInfoFromRocmSmi = (): Effect.Effect<GpuInfo[]> =>
  Effect.gen(function* () {
    const rocmSmi = resolveRocmSmiBinary();
    if (!rocmSmi) return [];

    const args = [
      "--showproductname",
      "--showmeminfo",
      "vram",
      "--showuse",
      "--showtemp",
      "--showpower",
    ];
    let result = yield* runCommandAsyncEffect(rocmSmi, args, { timeoutMs: 5_000 });
    if (result.status !== 0) {
      result = yield* runCommandAsyncEffect(rocmSmi, [], { timeoutMs: 5_000 });
    }

    const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (!combined.trim()) return [];

    const parsed = parseRocmSmiText(combined);
    if (parsed.length === 0) return [];

    const toMb = (bytes: number): number => Math.max(0, Math.round(bytes / 1024 ** 2));
    return parsed.map((gpu) => {
      const totalBytes = gpu.memory_total_bytes ?? 0;
      const usedBytes = gpu.memory_used_bytes ?? 0;
      const freeBytes = Math.max(0, totalBytes - usedBytes);
      const utilization = Math.max(0, Math.round(gpu.utilization_pct ?? 0));
      const temperatureC = Math.max(0, Math.round(gpu.temp_c ?? 0));
      const powerDraw = Math.max(0, Number(gpu.power_draw_w ?? 0));
      const powerLimit = Math.max(0, Number(gpu.power_limit_w ?? 0));

      return {
        index: gpu.index,
        name: gpu.name || "AMD GPU",
        memory_total_mb: toMb(totalBytes),
        memory_used_mb: toMb(usedBytes),
        memory_free_mb: toMb(freeBytes),
        utilization_pct: utilization,
        temp_c: temperatureC,
        power_draw: powerDraw,
        power_limit: powerLimit,
      } satisfies GpuInfo;
    });
  });
