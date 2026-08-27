import { Schema } from "effect";
import compactSource from "./model-recommendations.json";

export type QuantKind =
  | "nvfp4"
  | "fp8"
  | "awq"
  | "gptq"
  | "gguf"
  | "exl3"
  | "mlx"
  | "mixed-bit"
  | "bf16";
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

const QuantSchema = Schema.Literals([
  "nvfp4",
  "fp8",
  "awq",
  "gptq",
  "gguf",
  "exl3",
  "mlx",
  "mixed-bit",
  "bf16",
]);
const CommandTemplateIndexSchema = Schema.Literals([0, 1, 2, 3]);
const IndexSchema = Schema.Int;
const NullableNumber = Schema.NullOr(Schema.Number);
const NullableIndex = Schema.NullOr(IndexSchema);
const HardwareSchema = Schema.Tuple([
  Schema.String,
  Schema.Number,
  Schema.Number,
  Schema.Boolean,
  Schema.Boolean,
]);
const CompactNoteSchema = Schema.NullOr(
  Schema.Union([
    Schema.Tuple([Schema.Literal(0)]),
    Schema.Tuple([Schema.Literal(1), Schema.String]),
    Schema.Tuple([Schema.Literal(2), Schema.String]),
  ]),
);
const CompactBenchmarkSchema = Schema.Tuple([
  IndexSchema,
  NullableNumber,
  NullableNumber,
  NullableNumber,
  NullableNumber,
  NullableNumber,
  NullableIndex,
  NullableIndex,
]);
const CompactModelSchema = Schema.Tuple([
  IndexSchema,
  Schema.String,
  Schema.NullOr(Schema.String),
  IndexSchema,
  Schema.String,
  Schema.Number,
  IndexSchema,
  CommandTemplateIndexSchema,
  Schema.Array(IndexSchema),
  Schema.Number,
  Schema.Array(CompactBenchmarkSchema),
  NullableNumber,
  NullableNumber,
  NullableIndex,
  CompactNoteSchema,
]);
const CompactFileSchema = Schema.Struct({
  v: Schema.Number,
  u: Schema.String,
  s: Schema.String,
  a: Schema.Array(Schema.String),
  h: Schema.Array(HardwareSchema),
  y: Schema.Array(Schema.Array(IndexSchema)),
  q: Schema.Array(QuantSchema),
  d: Schema.Array(Schema.String),
  b: Schema.Array(Schema.String),
  p: Schema.Array(Schema.String),
  m: Schema.Array(CompactModelSchema),
  t: Schema.Array(Schema.String),
  f: Schema.Array(Schema.Array(IndexSchema)),
});

type CompactBenchmark = typeof CompactBenchmarkSchema.Type;
type CompactModel = typeof CompactModelSchema.Type;
type CompactFile = typeof CompactFileSchema.Type;

interface CommandTemplate {
  readonly engine: RecommendationEngine;
  readonly prefix: readonly string[];
  readonly servedName: boolean;
  readonly fixedArguments: readonly string[];
}

const commandTemplates: readonly [
  CommandTemplate,
  CommandTemplate,
  CommandTemplate,
  CommandTemplate,
] = [
  {
    engine: "vllm",
    prefix: ["vllm", "serve"],
    servedName: false,
    fixedArguments: [],
  },
  {
    engine: "vllm",
    prefix: ["vllm", "serve"],
    servedName: true,
    fixedArguments: [
      "--host",
      "0.0.0.0",
      "--port",
      "8000",
      "--tensor-parallel-size",
      "1",
      "--pipeline-parallel-size",
      "1",
      "--trust-remote-code",
      "--enable-chunked-prefill",
      "--enable-prefix-caching",
      "--enable-auto-tool-choice",
      "--enable-prompt-tokens-details",
      "--enable-force-include-usage",
      "--enable-request-id-headers",
      "--enable-log-requests",
    ],
  },
  {
    engine: "mlx",
    prefix: ["mlx_lm.server", "--model"],
    servedName: false,
    fixedArguments: [],
  },
  {
    engine: "llamacpp",
    prefix: ["llama-server", "-m"],
    servedName: false,
    fixedArguments: [],
  },
];

const dictionaryValue = <T>(values: readonly T[], index: number, category: string): T => {
  const value = values[index];
  if (value === undefined) throw new Error(`Invalid ${category} index ${index}`);
  return value;
};

const decodeNotes = (note: CompactModel[14]): readonly string[] => {
  if (note === null) return [];
  switch (note[0]) {
    case 0:
      return ["size estimated from parameter count"];
    case 1:
      return [`quality ${note[1]}% (tau2/gaia/gdpval mean)`];
    case 2:
      return [`quality ${note[1]}% (tau2/gaia/gdpval mean)`, "size estimated from parameter count"];
  }
};

const compact: CompactFile = Schema.decodeUnknownSync(CompactFileSchema)(compactSource);
const hardware: readonly HardwareTarget[] = compact.h.map((target) => ({
  id: target[0],
  label: target[0],
  minMemoryGb: target[1],
  gpuCount: target[2],
  unifiedMemory: target[3],
  tested: target[4],
}));

const decodeBenchmark = (
  benchmark: CompactBenchmark,
  engine: RecommendationEngine,
): BenchmarkRecord => ({
  hardwareId: dictionaryValue(hardware, benchmark[0], "hardware").id,
  engine,
  decodeTps: benchmark[1],
  decodeTps32k: benchmark[2],
  prefillTps: benchmark[3],
  ttftMs: benchmark[4],
  contextTokens: benchmark[5],
  measuredAt: benchmark[6] === null ? null : dictionaryValue(compact.d, benchmark[6], "date"),
  notes: benchmark[7] === null ? null : dictionaryValue(compact.b, benchmark[7], "benchmark note"),
});

export const bundledModelRecommendationsSource: ModelRecommendationsFile = {
  version: compact.v,
  updated: compact.u,
  source: compact.s,
  models: Object.fromEntries(
    compact.m.map((model) => {
      const organization = dictionaryValue(compact.a, model[0], "organization");
      const hfId = `${organization}/${model[1]}`;
      const commandTemplate = commandTemplates[model[7]];
      const command = [
        ...commandTemplate.prefix,
        hfId,
        ...(commandTemplate.servedName ? ["--served-model-name", hfId] : []),
        ...commandTemplate.fixedArguments,
        ...model[8].flatMap((fragmentIndex) =>
          dictionaryValue(compact.f, fragmentIndex, "command fragment").map((tokenIndex) =>
            dictionaryValue(compact.t, tokenIndex, "command token"),
          ),
        ),
      ].join(" ");
      return [
        hfId,
        {
          name: model[2] ?? model[1],
          quant: dictionaryValue(compact.q, model[3], "quantization"),
          filesize: model[4],
          filesizeGb: model[5],
          hardware: dictionaryValue(compact.y, model[6], "hardware set").map((index) =>
            dictionaryValue(hardware, index, "hardware"),
          ),
          commands: { [commandTemplate.engine]: command },
          rank: model[9],
          benchmarks: model[10].map((benchmark) =>
            decodeBenchmark(benchmark, commandTemplate.engine),
          ),
          expectSpeed: { decodeTps: model[11], prefillTps: model[12], source: "measured" },
          params:
            model[13] === null ? null : dictionaryValue(compact.p, model[13], "parameter count"),
          notes: decodeNotes(model[14]),
        },
      ];
    }),
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
  if (rig.appleSilicon)
    return Boolean(recommendation.commands.mlx ?? recommendation.commands.llamacpp);
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
