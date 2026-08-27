import { Schema } from "effect";
import compactSource from "./model-recommendations.json";

export type QuantKind = "nvfp4" | "fp8" | "awq" | "gptq" | "gguf" | "exl3" | "mlx" | "mixed-bit" | "bf16";
export type RecommendationEngine = "vllm" | "sglang" | "llamacpp" | "mlx" | "exllamav3";

export interface HardwareTarget {
  readonly id: string;
  readonly label: string;
  readonly minMemoryGb: number;
  readonly gpuCount: number;
  readonly unifiedMemory: boolean;
  readonly tested: boolean;
}

export interface BenchmarkRecord {
  readonly hardwareId: string;
  readonly engine: RecommendationEngine;
  readonly decodeTps: number | null;
  readonly decodeTps32k: number | null;
  readonly prefillTps: number | null;
  readonly ttftMs: number | null;
  readonly contextTokens: number | null;
  readonly measuredAt: string | null;
  readonly notes: string | null;
}

export interface ExpectedSpeed {
  readonly decodeTps: number | null;
  readonly prefillTps: number | null;
  readonly source: "measured" | "estimated";
}

export interface ModelRecommendation {
  readonly name: string;
  readonly quant: QuantKind;
  readonly filesize: string;
  readonly filesizeGb: number;
  readonly hardware: readonly HardwareTarget[];
  readonly commands: Readonly<Partial<Record<RecommendationEngine, string>>>;
  readonly rank: number;
  readonly benchmarks: readonly BenchmarkRecord[];
  readonly expectSpeed: ExpectedSpeed;
  readonly params: string | null;
  readonly notes: readonly string[];
}

export type ModelRecommendations = Readonly<Record<string, ModelRecommendation>>;

export interface ModelRecommendationsFile {
  readonly version: number;
  readonly updated: string;
  readonly source: string;
  readonly models: ModelRecommendations;
}

const EngineSchema = Schema.Literals(["vllm", "sglang", "llamacpp", "mlx", "exllamav3"]);
const NullableNumber = Schema.NullOr(Schema.Number);
const HardwareSchema = Schema.Struct({
  i: Schema.String,
  l: Schema.String,
  m: Schema.Number,
  g: Schema.Number,
  u: Schema.Boolean,
  t: Schema.Boolean,
});
const BenchmarkSchema = Schema.Struct({
  h: Schema.Number,
  e: EngineSchema,
  d: NullableNumber,
  x: NullableNumber,
  p: NullableNumber,
  t: NullableNumber,
  c: NullableNumber,
  m: Schema.NullOr(Schema.String),
  n: Schema.NullOr(Schema.String),
});
const CompactModelSchema = Schema.Struct({
  i: Schema.String,
  n: Schema.String,
  q: Schema.Literals(["nvfp4", "fp8", "awq", "gptq", "gguf", "exl3", "mlx", "mixed-bit", "bf16"]),
  f: Schema.String,
  z: Schema.Number,
  h: Schema.Array(Schema.Number),
  e: EngineSchema,
  c: Schema.String,
  r: Schema.Number,
  b: Schema.Array(BenchmarkSchema),
  d: NullableNumber,
  p: NullableNumber,
  s: Schema.Literals(["measured", "estimated"]),
  a: Schema.NullOr(Schema.String),
  o: Schema.Array(Schema.String),
});
const CompactFileSchema = Schema.Struct({
  v: Schema.Number,
  u: Schema.String,
  s: Schema.String,
  h: Schema.Array(HardwareSchema),
  m: Schema.Array(CompactModelSchema),
});

const compact = Schema.decodeUnknownSync(CompactFileSchema)(compactSource);
const hardware: readonly HardwareTarget[] = compact.h.map((target) => ({
  id: target.i,
  label: target.l,
  minMemoryGb: target.m,
  gpuCount: target.g,
  unifiedMemory: target.u,
  tested: target.t,
}));

export const bundledModelRecommendationsSource: ModelRecommendationsFile = {
  version: compact.v,
  updated: compact.u,
  source: compact.s,
  models: Object.fromEntries(
    compact.m.map((model) => [
      model.i,
      {
        name: model.n,
        quant: model.q,
        filesize: model.f,
        filesizeGb: model.z,
        hardware: model.h.map((index) => hardware[index]).filter((target) => target !== undefined),
        commands: { [model.e]: model.c },
        rank: model.r,
        benchmarks: model.b.map((benchmark) => ({
          hardwareId: hardware[benchmark.h]?.id ?? "",
          engine: benchmark.e,
          decodeTps: benchmark.d,
          decodeTps32k: benchmark.x,
          prefillTps: benchmark.p,
          ttftMs: benchmark.t,
          contextTokens: benchmark.c,
          measuredAt: benchmark.m,
          notes: benchmark.n,
        })),
        expectSpeed: { decodeTps: model.d, prefillTps: model.p, source: model.s },
        params: model.a,
        notes: model.o,
      },
    ]),
  ),
};

export interface RigDescriptor {
  readonly memoryPoolGb: number;
  readonly gpuCount: number;
  readonly unifiedMemory: boolean;
  readonly appleSilicon: boolean;
}

export const requiredPoolGb = (recommendation: ModelRecommendation): number =>
  Math.ceil(recommendation.filesizeGb * 1.5);

export const fitsRig = (recommendation: ModelRecommendation, rig: RigDescriptor): boolean => {
  if (rig.memoryPoolGb < requiredPoolGb(recommendation)) return false;
  if (rig.appleSilicon) return Boolean(recommendation.commands.mlx ?? recommendation.commands.llamacpp);
  return true;
};

export interface RankedRecommendation extends ModelRecommendation {
  readonly hfId: string;
  readonly measuredOnThisClass: boolean;
}

export const recommendationsForRig = (
  file: ModelRecommendationsFile,
  rig: RigDescriptor,
): readonly RankedRecommendation[] =>
  Object.entries(file.models)
    .filter(([, model]) => fitsRig(model, rig))
    .map(([hfId, model]) => ({
      ...model,
      hfId,
      measuredOnThisClass: model.hardware.some(
        (target) => target.tested && rig.memoryPoolGb >= target.minMemoryGb,
      ),
    }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        Number(right.measuredOnThisClass) - Number(left.measuredOnThisClass) ||
        right.filesizeGb - left.filesizeGb,
    );
