import recommendationsSource from "@shared/model-recommendations.json";
import {
  recommendationsForRig,
  requiredPoolGb,
  type ModelRecommendationsFile,
  type RankedRecommendation,
  type RigDescriptor,
} from "@shared/model-recommendations";
import type { StudioDiagnostics } from "@/lib/types";

// The static snapshot of everything we have actually benchmarked (see
// scripts/build-model-recommendations.mjs). Bundled at build time — the setup flow
// never needs the network to answer "what should this rig run".
const FILE = recommendationsSource as unknown as ModelRecommendationsFile;

export const rigFromDiagnostics = (
  diagnostics: StudioDiagnostics | null,
  maxVramGb: number,
): RigDescriptor => {
  const appleSilicon = diagnostics?.platform === "darwin" && diagnostics.arch === "arm64";
  const unified = appleSilicon;
  const ramGb = diagnostics ? diagnostics.memory_total / 1024 ** 3 : 0;
  return {
    // Unified hosts budget RAM; discrete rigs budget summed VRAM.
    memoryPoolGb: unified ? ramGb : maxVramGb,
    gpuCount: diagnostics?.gpus.length ?? 0,
    unifiedMemory: unified,
    appleSilicon,
  };
};

export interface SetupRecommendation extends RankedRecommendation {
  readonly requiredGb: number;
  /** Decode tok/s measured on hardware closest to this rig's pool, else the best. */
  readonly rigDecodeTps: number | null;
  readonly engine: string | null;
}

const closestBenchmark = (
  recommendation: RankedRecommendation,
  rig: RigDescriptor,
): { decodeTps: number | null; engine: string | null } => {
  const tested = recommendation.hardware.filter((target) => target.tested);
  const closest = [...tested].sort(
    (a, b) =>
      Math.abs(a.minMemoryGb - rig.memoryPoolGb) - Math.abs(b.minMemoryGb - rig.memoryPoolGb),
  )[0];
  const row = closest
    ? recommendation.benchmarks.find((benchmark) => benchmark.hardwareId === closest.id)
    : recommendation.benchmarks[0];
  return { decodeTps: row?.decodeTps ?? null, engine: row?.engine ?? null };
};

export const setupRecommendations = (
  diagnostics: StudioDiagnostics | null,
  maxVramGb: number,
  limit = 6,
): readonly SetupRecommendation[] => {
  const rig = rigFromDiagnostics(diagnostics, maxVramGb);
  if (rig.memoryPoolGb <= 0) return [];
  return recommendationsForRig(FILE, rig)
    .slice(0, limit)
    .map((recommendation) => {
      const closest = closestBenchmark(recommendation, rig);
      return {
        ...recommendation,
        requiredGb: requiredPoolGb(recommendation),
        rigDecodeTps: closest.decodeTps,
        engine: closest.engine,
      };
    });
};

export const recommendationsUpdated = (): string => FILE.updated;
