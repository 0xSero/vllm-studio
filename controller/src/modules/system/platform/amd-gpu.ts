import type { GpuInfo } from "../../models/types";
import { Effect } from "effect";
import { runCommandAsyncEffect } from "../../../core/command";
import { resolveAmdSmiBinary, resolveRocmSmiBinary } from "./smi-tools";

type AmdSmiValue = { value?: number; unit?: string } | "N/A" | null;

type AmdSmiMetricGpu = {
  gpu?: number;
  mem_usage?: {
    total_vram?: AmdSmiValue;
    used_vram?: AmdSmiValue;
    free_vram?: AmdSmiValue;
  };
  usage?: {
    gfx_activity?: AmdSmiValue;
  };
  temperature?: {
    hotspot?: AmdSmiValue;
    edge?: AmdSmiValue;
  };
  power?: {
    socket_power?: AmdSmiValue;
  };
};

type AmdSmiStaticGpu = {
  gpu?: number;
  asic?: {
    market_name?: string;
  };
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readAmdSmiValueNumber = (value: AmdSmiValue | undefined): number | null => {
  if (!value || value === "N/A" || !isRecord(value)) return null;
  const raw = value["value"];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
};

const readAmdSmiValueMb = (value: AmdSmiValue | undefined): number | null => {
  const raw = readAmdSmiValueNumber(value);
  if (raw === null) return null;
  const unit =
    isRecord(value) && typeof value["unit"] === "string" ? value["unit"].toLowerCase() : "";
  return unit === "gb" || unit === "gib" ? raw * 1024 : raw;
};

const parseAmdSmiGpuData = <T>(jsonText: string): T[] => {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!isRecord(parsed)) return [];
    const gpuData = parsed["gpu_data"];
    if (!Array.isArray(gpuData)) return [];
    return gpuData.filter((entry) => isRecord(entry)) as T[];
  } catch {
    return [];
  }
};

export const parseAmdSmiMetricJson = (jsonText: string): AmdSmiMetricGpu[] =>
  parseAmdSmiGpuData<AmdSmiMetricGpu>(jsonText);

export const parseAmdSmiStaticJson = (jsonText: string): AmdSmiStaticGpu[] =>
  parseAmdSmiGpuData<AmdSmiStaticGpu>(jsonText);

const parseRocmSmiValue = (raw: string): { value: number; unit: string } | null => {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z%]+)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: (match[2] ?? "").trim() };
};

const BYTE_UNIT_SCALE: Record<string, number> = {
  "": 1,
  b: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
};

/** Parse a `rocm-smi` scalar, taking the unit from the label when the value omits it. */
const rocmSmiBytes = (raw: string, label: string): number | null => {
  const parsed = parseRocmSmiValue(raw);
  if (!parsed) return null;
  const labelUnit = label.match(/\((kib|mib|gib|tib|kb|mb|gb|tb|b)\)/i);
  const scale = BYTE_UNIT_SCALE[(parsed.unit || (labelUnit?.[1] ?? "")).toLowerCase()];
  return scale === undefined ? null : Math.round(parsed.value * scale);
};

const rocmSmiNumber = (raw: string, strip: string | RegExp): number | null =>
  parseRocmSmiValue(raw.replace(strip, "").trim())?.value ?? null;

const emptyRocmSmiGpu = (index: number): RocmSmiParsed => ({
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

  for (const line of text.split("\n")) {
    const match = line.trim().match(/GPU\[(\d+)\]\s*:\s*([^:]+?)\s*:\s*(.*)$/i);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isFinite(index)) continue;

    const label = (match[2] ?? "").trim().toLowerCase();
    const valueText = (match[3] ?? "").trim();
    const entry = byIndex.get(index) ?? emptyRocmSmiGpu(index);

    if (label.includes("card model")) {
      if (valueText) entry.name = valueText;
    } else if (label.includes("card series") && entry.name === "AMD GPU") {
      if (valueText) entry.name = valueText;
    } else if (label.includes("total vram")) {
      entry.memory_total_bytes = rocmSmiBytes(valueText, label);
    } else if (label.includes("used vram")) {
      entry.memory_used_bytes = rocmSmiBytes(valueText, label);
    } else if (label.includes("gpu use")) {
      entry.utilization_pct = rocmSmiNumber(valueText, "%");
    } else if (label.includes("temperature") && label.includes("(c)")) {
      entry.temp_c = rocmSmiNumber(valueText, /c$/i);
    } else if (label.includes("average") && label.includes("power") && label.includes("(w)")) {
      entry.power_draw_w = rocmSmiNumber(valueText, /w$/i);
    } else if ((label.includes("power cap") || label.includes("max")) && label.includes("(w)")) {
      entry.power_limit_w = rocmSmiNumber(valueText, /w$/i);
    }

    byIndex.set(index, entry);
  }

  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
};

/** Clamp to a non-negative integer; every AMD reading is a count, a percentage or a temperature. */
const clampRound = (value: number): number => Math.max(0, Math.round(value));

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

    const statics = parseAmdSmiStaticJson(staticResult.stdout);
    const staticByGpu = new Map<number, AmdSmiStaticGpu>();
    for (const entry of statics) {
      if (typeof entry.gpu === "number") staticByGpu.set(entry.gpu, entry);
    }

    return parseAmdSmiMetricJson(metricResult.stdout)
      .map((metric) => {
        const index = metric.gpu;
        if (typeof index !== "number") return null;

        const totalMb = readAmdSmiValueMb(metric.mem_usage?.total_vram) ?? 0;
        const usedMb = readAmdSmiValueMb(metric.mem_usage?.used_vram) ?? 0;
        const freeMb =
          readAmdSmiValueMb(metric.mem_usage?.free_vram) ?? Math.max(0, totalMb - usedMb);

        return {
          index,
          name: staticByGpu.get(index)?.asic?.market_name ?? "AMD GPU",
          memory_total_mb: clampRound(totalMb),
          memory_used_mb: clampRound(usedMb),
          memory_free_mb: clampRound(freeMb),
          utilization_pct: clampRound(readAmdSmiValueNumber(metric.usage?.gfx_activity) ?? 0),
          temp_c: clampRound(
            readAmdSmiValueNumber(metric.temperature?.hotspot) ??
              readAmdSmiValueNumber(metric.temperature?.edge) ??
              0,
          ),
          power_draw: Math.max(0, readAmdSmiValueNumber(metric.power?.socket_power) ?? 0),
          power_limit: 0,
        } satisfies GpuInfo;
      })
      .filter((entry): entry is GpuInfo => Boolean(entry));
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

    const toMb = (bytes: number): number => Math.max(0, Math.round(bytes / 1024 ** 2));
    return parseRocmSmiText(combined).map((gpu) => {
      const totalBytes = gpu.memory_total_bytes ?? 0;
      const usedBytes = gpu.memory_used_bytes ?? 0;

      return {
        index: gpu.index,
        name: gpu.name || "AMD GPU",
        memory_total_mb: toMb(totalBytes),
        memory_used_mb: toMb(usedBytes),
        memory_free_mb: toMb(Math.max(0, totalBytes - usedBytes)),
        utilization_pct: clampRound(gpu.utilization_pct ?? 0),
        temp_c: clampRound(gpu.temp_c ?? 0),
        power_draw: Math.max(0, gpu.power_draw_w ?? 0),
        power_limit: Math.max(0, gpu.power_limit_w ?? 0),
      } satisfies GpuInfo;
    });
  });
