import type { RegistryHardware, RegistryHardwareMatch } from "@local-studio/contracts/registry";
import type { GpuInfo } from "../models/types";
import { arch, platform, totalmem } from "node:os";

/** One detected accelerator group, already collapsed by identical name+memory. */
export interface DetectedAccelerator {
  readonly name: string;
  /** VRAM in GB; null when the platform does not report it (Apple unified memory uses total RAM). */
  readonly memoryGb: number | null;
  count: number;
}

const FILLER_WORDS = new Set([
  "nvidia",
  "geforce",
  "amd",
  "radeon",
  "intel",
  "apple",
  "graphics",
  "gpu",
  "edition",
  "oc",
]);

const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 0 && !FILLER_WORDS.has(word))
    .join(" ");

const MEMORY_TOLERANCE_GB = 1;

interface CandidateMatch {
  readonly hardware: RegistryHardware;
  readonly score: number;
  readonly memoryOk: boolean;
  readonly basis: string;
}

const scoreAgainst = (detected: DetectedAccelerator, hardware: RegistryHardware): CandidateMatch | null => {
  const detectedKey = normalizeName(detected.name);
  if (!detectedKey) return null;
  const candidates: Array<{ key: string; score: number; basis: string }> = [
    { key: normalizeName(hardware.name), score: 100, basis: "name" },
    { key: normalizeName(hardware.family ?? ""), score: 60, basis: "family" },
    ...(hardware.aliases ?? []).map((alias) => ({
      key: normalizeName(alias),
      score: 90,
      basis: "alias",
    })),
    ...(hardware.products ?? []).map((product) => ({
      key: normalizeName(product),
      score: 90,
      basis: "product",
    })),
  ];
  let best: { score: number; basis: string } | null = null;
  for (const candidate of candidates) {
    if (!candidate.key) continue;
    if (candidate.key === detectedKey) {
      if (!best || candidate.score > best.score) best = { score: candidate.score, basis: candidate.basis };
      continue;
    }
    // Partial containment keeps "rtx 5090" aliases matching "rtx 5090 32gb"
    // style keys without letting "rtx 50" match everything.
    if (
      candidate.key.length >= 6 &&
      (detectedKey.includes(candidate.key) || candidate.key.includes(detectedKey))
    ) {
      const partial = 40;
      if (!best || partial > best.score) best = { score: partial, basis: "partial" };
    }
  }
  if (!best) return null;
  const registryMemory = hardware.memory.vram_gb;
  const memoryOk =
    detected.memoryGb == null ||
    registryMemory == null ||
    Math.abs(detected.memoryGb - registryMemory) <= MEMORY_TOLERANCE_GB;
  return { hardware, score: memoryOk ? best.score : 0, memoryOk, basis: best.basis };
};

/**
 * Match detected accelerators against the registry hardware collection. The
 * best name match wins per detected group; a memory mismatch above the
 * tolerance downgrades the candidate so "RTX 5090 32GB" never satisfies an
 * "RTX 5090 24GB" registry record.
 */
export const matchAccelerators = (
  detected: readonly DetectedAccelerator[],
  registry: readonly RegistryHardware[],
): RegistryHardwareMatch[] => {
  const matches: RegistryHardwareMatch[] = [];
  for (const accelerator of detected) {
    const scored = registry
      .map((hardware) => scoreAgainst(accelerator, hardware))
      .filter((match): match is CandidateMatch => match !== null)
      .sort((a, b) => b.score - a.score || a.hardware.id.localeCompare(b.hardware.id));
    const best = scored[0];
    if (!best || best.score <= 0) {
      matches.push({
        hardware_id: "",
        registry_name: "",
        detected_name: accelerator.name,
        vendor: "unknown",
        memory_gb: accelerator.memoryGb,
        registry_memory_gb: null,
        detected_count: accelerator.count,
        matched: false,
        reason: "No registry hardware record matches this accelerator",
      });
      continue;
    }
    matches.push({
      hardware_id: best.hardware.id,
      registry_name: best.hardware.name,
      detected_name: accelerator.name,
      vendor: best.hardware.vendor,
      memory_gb: accelerator.memoryGb,
      registry_memory_gb: best.hardware.memory.vram_gb,
      detected_count: accelerator.count,
      matched: true,
      reason: `Matched by ${best.basis}${
        accelerator.memoryGb == null ? "" : best.memoryOk ? " with memory within 1 GB" : ""
      }`,
    });
  }
  return matches;
};

/** Collapse a flat GPU list into per-model groups, the way rigs report them. */
export const detectedFromGpus = (gpus: readonly GpuInfo[]): DetectedAccelerator[] => {
  const groups = new Map<string, DetectedAccelerator>();
  for (const gpu of gpus) {
    const memoryGb = gpu.memory_total_mb > 0 ? Math.round(gpu.memory_total_mb / 1024) : null;
    const key = `${gpu.name}::${memoryGb ?? "?"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(key, { name: gpu.name, memoryGb, count: 1 });
  }
  return [...groups.values()];
};

/**
 * Apple Silicon exposes no GPU list on most installs; the chip and the unified
 * memory size are the hardware identity, matching registry records such as
 * `apple-m4-pro-48gb`.
 */
export const detectedAppleSilicon = (
  cpuModel: string | null,
  options?: { platform?: NodeJS.Platform; arch?: string; totalMemoryBytes?: number },
): DetectedAccelerator[] => {
  const onAppleSilicon =
    (options?.platform ?? platform()) === "darwin" && (options?.arch ?? arch()) === "arm64";
  if (!onAppleSilicon) return [];
  return [
    {
      name: cpuModel ?? "Apple Silicon",
      memoryGb:
        options?.totalMemoryBytes != null
          ? Math.round(options.totalMemoryBytes / 1024 ** 3)
          : Math.round(totalmem() / 1024 ** 3),
      count: 1,
    },
  ];
};

export const fitStateFor = (
  row: { hardware_id: string; hardware_count: number },
  matches: readonly RegistryHardwareMatch[],
): "match" | "other" => {
  const match = matches.find((candidate) => candidate.hardware_id === row.hardware_id);
  if (!match) return "other";
  return match.detected_count >= row.hardware_count ? "match" : "other";
};
