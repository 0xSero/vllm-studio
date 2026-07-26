#!/usr/bin/env node
/**
 * Materialize local.ai's measured benchmark data into shared/model-recommendations.json.
 *
 * Sources:
 *   - local.ai public Convex API (pgCatalog:snapshot + pgCatalog:modelDetail):
 *     models, hardware classes, speed runs (with the exact recipe_args used), eval runs.
 *   - ~/ai/local-ai-web/public/data/v1/model-disk-sizes.json: weights size on disk.
 *
 * Output entries are keyed by Hugging Face repo id and carry only what was actually
 * measured; estimated fields are labelled as such. Re-run this script to refresh the
 * snapshot — the JSON is committed so the app never needs the network.
 *
 * Usage: node scripts/build-model-recommendations.mjs [--out shared/model-recommendations.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONVEX_URL = process.env.LOCALAI_CONVEX_URL ?? "https://small-spoonbill-302.convex.cloud";
const DISK_SIZES_PATH =
  process.env.LOCALAI_DISK_SIZES ??
  join(homedir(), "ai/local-ai-web/public/data/v1/model-disk-sizes.json");
const OUT_PATH = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "shared/model-recommendations.json";

const DETAIL_CONCURRENCY = 8;

/* ── convex client ───────────────────────────────────────────────────────── */

async function convexQuery(path, args) {
  const response = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== "success") throw new Error(`${path}: ${JSON.stringify(payload)}`);
  return payload.value;
}

/* ── hardware classes ────────────────────────────────────────────────────── */

// hardware_key -> presentation + matching facts. Memory comes from the key suffix
// (e.g. rtxpro6000_96 = 96 GB); unified-memory devices are flagged so the frontend
// budgets RAM, not VRAM.
// Stem -> unified-memory flag + default pool for keys that omit it (gb300 = 288 GB HBM).
const HARDWARE_STEMS = {
  gb10: { unified: true, defaultMemoryGb: 121 },
  gb300: { unified: true, defaultMemoryGb: 288 },
  rtxpro6000: { unified: false },
  rtx6000ada: { unified: false },
  rtx5090: { unified: false },
  rtx4090: { unified: false },
};

/**
 * Key forms seen in the data:
 *   "rtxpro6000_96"      one 96 GB card
 *   "gb10_121"           DGX Spark, 121 GB unified
 *   "gb300x2"            two GB300s, memory implied by stem
 *   "m4_max_36_32c"      Apple M4 Max, 36 GB unified, 32 GPU cores
 *   "m3_ultra_512_80c"   Apple M3 Ultra, 512 GB unified
 * Memory = the last numeric segment that is not a core-count ("...c"); an xN suffix
 * anywhere multiplies device count.
 */
function parseHardwareKey(key) {
  const appleLike = /^m\d/.test(key);
  let working = key;
  let count = 1;
  const multiplied = /^(.*)x(\d+)$/.exec(working);
  if (multiplied && !/\d+c$/.test(working)) {
    working = multiplied[1];
    count = Number(multiplied[2]);
  }
  const segments = working.split("_");
  let memoryGb = null;
  for (let index = segments.length - 1; index > 0; index -= 1) {
    if (/^\d+$/.test(segments[index])) {
      memoryGb = Number(segments[index]);
      break;
    }
  }
  const stem = appleLike ? segments.slice(0, 2).join("_") : segments[0];
  return { stem, memoryGb, count, unified: appleLike || (HARDWARE_STEMS[stem]?.unified ?? false) };
}

function hardwareTarget(key, displayName, tested) {
  const { stem, memoryGb, count, unified } = parseHardwareKey(key);
  const fallbackMemory = HARDWARE_STEMS[stem]?.defaultMemoryGb ?? 0;
  return {
    id: key,
    label: displayName ?? key,
    minMemoryGb: (memoryGb ?? fallbackMemory) * count,
    gpuCount: count,
    unifiedMemory: unified,
    tested,
  };
}

/* ── quant inference ─────────────────────────────────────────────────────── */

const QUANT_PATTERNS = [
  [/nvfp4/i, "nvfp4"],
  [/fp8/i, "fp8"],
  [/awq/i, "awq"],
  [/gptq/i, "gptq"],
  [/gguf|q[2-8]_[a-z0-9_]+|iq[1-4]/i, "gguf"],
  [/exl3/i, "exl3"],
  [/mlx|[-_](\d)bit/i, "mlx"],
  [/mixed/i, "mixed-bit"],
  [/bf16|fp16/i, "bf16"],
];

function inferQuant(declared, hfRepo, engine) {
  if (declared && declared !== "unknown") {
    const normalized = declared.toLowerCase().replaceAll("-", "");
    for (const [, kind] of QUANT_PATTERNS) {
      if (normalized === kind.replaceAll("-", "")) return kind;
    }
    for (const [pattern, kind] of QUANT_PATTERNS) if (pattern.test(declared)) return kind;
  }
  for (const [pattern, kind] of QUANT_PATTERNS) if (pattern.test(hfRepo)) return kind;
  if (engine === "mlx") return "mlx";
  if (engine === "llamacpp") return "gguf";
  return "bf16";
}

/* ── commands ────────────────────────────────────────────────────────────── */

/** The argv actually used for the run: runnable_serve.serve_argv is complete (includes
 *  the model flags); recipe_args is the older partial form. */
function runArgv(run) {
  const serve = run.inferenceEngineConfig?.runnable_serve?.serve_argv;
  if (Array.isArray(serve) && serve.length > 0) return { argv: serve, complete: true };
  const recipe = run.inferenceEngineConfig?.recipe_args;
  if (Array.isArray(recipe) && recipe.length > 0) return { argv: recipe, complete: false };
  return { argv: [], complete: false };
}

/** Strip `--model X` / `--served-model-name X` style pairs so the command can carry the
 *  model positionally where the engine wants it that way. */
function withoutFlag(argv, flag) {
  const output = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      index += 1; // skip the value too
      continue;
    }
    output.push(argv[index]);
  }
  return output;
}

/** Quote argv tokens that the shell would otherwise mangle (JSON blobs, spaces). */
function shellToken(token) {
  return /^[A-Za-z0-9@%_+=:,./-]+$/.test(token) ? token : `'${token.replaceAll("'", `'\\''`)}'`;
}

function commandFor(engine, hfRepo, run) {
  const { argv: rawArgv } = runArgv(run);
  const argv = rawArgv.map(shellToken);
  switch (engine) {
    case "vllm": {
      const rest = withoutFlag(argv, "--model").join(" ");
      return `vllm serve ${hfRepo}${rest ? ` ${rest}` : ""}`.trim();
    }
    case "sglang": {
      const rest = withoutFlag(withoutFlag(argv, "--model-path"), "--model").join(" ");
      return `python -m sglang.launch_server --model-path ${hfRepo}${rest ? ` ${rest}` : ""}`.trim();
    }
    case "llamacpp": {
      const rest = withoutFlag(withoutFlag(argv, "-m"), "--model").join(" ");
      return `llama-server -m ${hfRepo}${rest ? ` ${rest}` : ""}`.trim();
    }
    case "mlx": {
      const rest = withoutFlag(argv, "--model").join(" ");
      return `mlx_lm.server --model ${hfRepo}${rest ? ` ${rest}` : ""}`.trim();
    }
    default:
      return null;
  }
}

/* ── speed & quality helpers ─────────────────────────────────────────────── */

// Runs carry raw sweep points ({promptTokens, generationTps, promptTps, cachedPromptTokens}),
// not precomputed rates. Decode-at-context = generationTps of the point nearest that
// context; prefill = peak promptTps over uncached points (cached points measure the
// prefix cache, not the GPU).
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// Median over a +/-50% context window, not a single point: individual sweep points
// glitch (sub-millisecond timings on 16-token completions produce five-digit "tok/s"),
// and a median inside the window shrugs those off. No points in the window -> null,
// never a far-away substitute.
const decodeAt = (points, contextTokens) =>
  median(
    (points ?? [])
      .filter(
        (point) =>
          typeof point.generationTps === "number" &&
          (point.completionTokens ?? 0) >= 8 &&
          Math.abs(point.promptTokens - contextTokens) <= contextTokens * 0.5,
      )
      .map((point) => point.generationTps),
  );

const runSpeeds = (run) => {
  const points = run.points ?? [];
  let maxContext = null;
  const prefillSamples = [];
  for (const point of points) {
    if (typeof point.promptTokens === "number") {
      maxContext = Math.max(maxContext ?? 0, point.promptTokens);
    }
    if ((point.cachedPromptTokens ?? 0) === 0 && typeof point.promptTps === "number" && point.promptTokens >= 2048) {
      prefillSamples.push(point.promptTps);
    }
  }
  return {
    decode8k: decodeAt(points, 8192),
    decode32k: decodeAt(points, 32768),
    prefill: median(prefillSamples),
    maxContext,
  };
};

const decodeOf = (run) => {
  const speeds = runSpeeds(run);
  return speeds.decode8k ?? speeds.decode32k;
};

const EVAL_FAMILIES = ["tau2", "gaia", "gdpval"];

function qualityOf(evalRuns) {
  const best = new Map();
  for (const run of evalRuns ?? []) {
    if (!EVAL_FAMILIES.includes(run.evalFamily)) continue;
    if (typeof run.meanTaskScore !== "number") continue;
    const current = best.get(run.evalFamily);
    if (current === undefined || run.meanTaskScore > current) {
      best.set(run.evalFamily, run.meanTaskScore);
    }
  }
  if (best.size === 0) return null;
  return [...best.values()].reduce((sum, value) => sum + value, 0) / best.size;
}

/* ── size estimation ─────────────────────────────────────────────────────── */

const BYTES_PER_PARAM = {
  bf16: 2,
  fp8: 1.05,
  nvfp4: 0.58,
  awq: 0.6,
  gptq: 0.6,
  gguf: 0.65, // typical q4_k_m
  exl3: 0.55,
  mlx: 0.6,
  "mixed-bit": 0.7,
};

function estimateSizeGb(paramsB, quant) {
  if (!paramsB) return null;
  const perParam = BYTES_PER_PARAM[quant] ?? 1;
  return Math.round(paramsB * perParam * 1.08); // +8% for embeddings/head/metadata
}

/** Weights size straight from the HF API when local-ai-web has no entry. Weight files
 *  only — configs and tokenizers are noise at this scale. */
const WEIGHT_FILE = /\.(safetensors|gguf|bin|pt|npz)$/;
async function hfRepoSizeGb(hfRepo) {
  try {
    const response = await fetch(
      `https://huggingface.co/api/models/${hfRepo}?blobs=true`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const bytes = (payload.siblings ?? [])
      .filter((sibling) => WEIGHT_FILE.test(sibling.rfilename ?? ""))
      .reduce((sum, sibling) => sum + (sibling.size ?? 0), 0);
    return bytes > 0 ? bytes / 1024 ** 3 : null;
  } catch {
    return null;
  }
}

function paramsFromName(name) {
  const match = /(\d+(?:\.\d+)?)\s*B/i.exec(name ?? "");
  return match ? Number(match[1]) : null;
}

/* ── main ────────────────────────────────────────────────────────────────── */

const snapshot = await convexQuery("pgCatalog:snapshot", {});
const models = snapshot.models ?? [];
const hardwareRows = snapshot.hardware ?? [];
console.log(
  `snapshot: publication=${snapshot.publicationId} models=${models.length} hardware=${hardwareRows.length}`,
);

const hardwareNames = new Map(hardwareRows.map((row) => [row.hardwareKey, row.displayName]));

let diskSizes = [];
try {
  const parsed = JSON.parse(readFileSync(DISK_SIZES_PATH, "utf8"));
  diskSizes = Array.isArray(parsed) ? parsed : (parsed.sizes ?? []);
} catch {
  console.warn(`disk sizes not found at ${DISK_SIZES_PATH}; sizes will be estimated`);
}
const sizeByRepo = new Map();
for (const entry of diskSizes) {
  const key = (entry.hfRepo ?? entry.modelId ?? "").toLowerCase();
  if (key && entry.diskBytes > 0) sizeByRepo.set(key, entry.diskBytes / 1024 ** 3);
}

const withRuns = models.filter((model) => (model.speedSweepCount ?? 0) > 0);
console.log(`models with speed runs: ${withRuns.length}`);

const details = new Map();
for (let index = 0; index < withRuns.length; index += DETAIL_CONCURRENCY) {
  const batch = withRuns.slice(index, index + DETAIL_CONCURRENCY);
  const resolved = await Promise.all(
    batch.map(async (model) => {
      try {
        return [model, await convexQuery("pgCatalog:modelDetail", { routeSlug: model.routeSlug })];
      } catch (error) {
        console.warn(`detail failed for ${model.routeSlug}: ${error.message}`);
        return [model, null];
      }
    }),
  );
  for (const [model, detail] of resolved) if (detail) details.set(model.routeSlug, detail);
  process.stdout.write(`\rdetails: ${Math.min(index + DETAIL_CONCURRENCY, withRuns.length)}/${withRuns.length}`);
}
console.log();

/* Build entries */
const entries = new Map();

for (const model of withRuns) {
  const detail = details.get(model.routeSlug);
  if (!detail) continue;
  const speedRuns = detail.speedRuns ?? [];
  if (speedRuns.length === 0) continue;

  const hfRepo = model.hfRepo ?? model.modelId;
  if (!hfRepo || !hfRepo.includes("/")) continue;

  // Best run per (engine, hardware) — decode tps as the tiebreaker.
  // Single-stream runs only: concurrency>1 inflates decode tok/s into a batch
  // throughput number, which is not what one user at a keyboard will see.
  const bestByEngineHardware = new Map();
  for (const run of speedRuns) {
    const engine = run.inferenceEngine;
    if (!engine) continue;
    const key = `${engine} ${run.hardwareKey}`;
    const current = bestByEngineHardware.get(key);
    const currentSingle = current ? (current.concurrency ?? 1) === 1 : false;
    const runSingle = (run.concurrency ?? 1) === 1;
    if (
      !current ||
      (runSingle && !currentSingle) ||
      (runSingle === currentSingle && (decodeOf(run) ?? 0) > (decodeOf(current) ?? 0))
    ) {
      bestByEngineHardware.set(key, run);
    }
  }

  // Commands: best run per engine overall; borrow argv from the engine's best-
  // documented run when the top run recorded none.
  const commands = {};
  const testedHardware = new Map();
  const benchmarks = [];
  let bestDecode = null;
  let bestPrefill = null;

  for (const [key, run] of bestByEngineHardware) {
    const [engine, hardwareKey] = key.split(" ");
    testedHardware.set(hardwareKey, hardwareTarget(hardwareKey, hardwareNames.get(hardwareKey), true));
    const speeds = runSpeeds(run);
    const decode = speeds.decode8k ?? speeds.decode32k;
    if (decode !== null && (bestDecode === null || decode > bestDecode)) bestDecode = decode;
    if (speeds.prefill !== null && (bestPrefill === null || speeds.prefill > bestPrefill)) {
      bestPrefill = speeds.prefill;
    }
    benchmarks.push({
      hardwareId: hardwareKey,
      engine,
      decodeTps: decode === null ? null : Math.round(decode * 10) / 10,
      decodeTps32k: speeds.decode32k === null ? null : Math.round(speeds.decode32k * 10) / 10,
      prefillTps: speeds.prefill === null ? null : Math.round(speeds.prefill * 10) / 10,
      ttftMs: null,
      contextTokens: speeds.maxContext,
      measuredAt: run.points?.[0]?.createdAt?.slice(0, 10) ?? null,
      notes: run.inferenceEngineVersion ? `${engine} ${run.inferenceEngineVersion}` : null,
    });
    const { complete } = runArgv(run);
    if (!commands[engine] || complete) {
      const command = commandFor(engine, hfRepo, run);
      if (command) commands[engine] = command;
    }
  }

  const quant = inferQuant(model.quantization, hfRepo, benchmarks[0]?.engine ?? null);
  const measuredSize =
    sizeByRepo.get(hfRepo.toLowerCase()) ??
    sizeByRepo.get((model.modelId ?? "").toLowerCase()) ??
    (await hfRepoSizeGb(hfRepo));
  const paramsB = paramsFromName(model.displayName ?? hfRepo);
  const sizeGb = measuredSize ?? estimateSizeGb(paramsB, quant);
  if (!sizeGb) continue; // no honest way to hardware-match without a size

  const quality = qualityOf(detail.evalRuns);

  entries.set(hfRepo, {
    name: model.displayName ?? hfRepo.split("/").pop(),
    quant,
    filesize: `${Math.round(sizeGb)}gb`,
    filesizeGb: Math.round(sizeGb * 10) / 10,
    hardware: [...testedHardware.values()].sort((a, b) => a.minMemoryGb - b.minMemoryGb),
    commands,
    rank: 0, // assigned below
    benchmarks: benchmarks.sort((a, b) => (b.decodeTps ?? 0) - (a.decodeTps ?? 0)),
    expectSpeed: {
      decodeTps: bestDecode === null ? null : Math.round(bestDecode * 10) / 10,
      prefillTps: bestPrefill === null ? null : Math.round(bestPrefill * 10) / 10,
      source: "measured",
    },
    params: paramsFromName(model.displayName ?? hfRepo) ? (model.displayName ?? hfRepo).match(/(\d+(?:\.\d+)?B(?:-A\d+(?:\.\d+)?B)?)/)?.[1] ?? null : null,
    notes: [],
    _quality: quality,
    _sizeEstimated: !measuredSize,
  });
}

/* Derived hardware: any class whose pool covers size*1.5 also fits (untested). */
const allTargets = new Map();
for (const row of hardwareRows) {
  const target = hardwareTarget(row.hardwareKey, row.displayName, false);
  if (target.minMemoryGb > 0) allTargets.set(row.hardwareKey, target);
}
for (const entry of entries.values()) {
  const needed = entry.filesizeGb * 1.5;
  const tested = new Set(entry.hardware.map((target) => target.id));
  for (const target of allTargets.values()) {
    if (!tested.has(target.id) && target.minMemoryGb >= needed) {
      entry.hardware.push(target);
    }
  }
  entry.hardware.sort((a, b) => a.minMemoryGb - b.minMemoryGb);
}

/* Rank: pareto layers over (best decode tps, quality). Models missing quality rank
   after the frontier of measured-quality models, ordered by decode. */
const ranked = [...entries.values()];
const scored = ranked.filter((entry) => entry._quality !== null && entry.expectSpeed.decodeTps !== null);
const layers = [];
let pool = [...scored];
while (pool.length > 0) {
  const layer = pool.filter(
    (candidate) =>
      !pool.some(
        (other) =>
          other !== candidate &&
          other.expectSpeed.decodeTps >= candidate.expectSpeed.decodeTps &&
          other._quality >= candidate._quality &&
          (other.expectSpeed.decodeTps > candidate.expectSpeed.decodeTps ||
            other._quality > candidate._quality),
      ),
  );
  layers.push(layer);
  pool = pool.filter((entry) => !layer.includes(entry));
}
layers.forEach((layer, index) => {
  for (const entry of layer) entry.rank = index + 1;
});
const unscored = ranked
  .filter((entry) => !scored.includes(entry))
  .sort((a, b) => (b.expectSpeed.decodeTps ?? 0) - (a.expectSpeed.decodeTps ?? 0));
unscored.forEach((entry) => {
  entry.rank = layers.length + 1;
});

/* Attach quality benchmark rows + notes, strip temporaries */
const output = {};
for (const [hfRepo, entry] of [...entries.entries()].sort((a, b) => a[1].rank - b[1].rank)) {
  const { _quality, _sizeEstimated, ...clean } = entry;
  if (_quality !== null) {
    clean.notes = [...clean.notes, `quality ${Math.round(_quality * 1000) / 10}% (tau2/gaia/gdpval mean)`];
  }
  if (_sizeEstimated) {
    clean.notes = [...clean.notes, "size estimated from parameter count"];
  }
  output[hfRepo] = clean;
}

const file = {
  version: 1,
  updated: new Date().toISOString().slice(0, 10),
  source: `local.ai publication ${snapshot.publicationId}`,
  models: output,
};

writeFileSync(OUT_PATH, `${JSON.stringify(file, null, 2)}\n`);
console.log(`wrote ${Object.keys(output).length} entries -> ${OUT_PATH}`);
const measured = [...entries.values()].filter((entry) => !entry._sizeEstimated).length;
console.log(`sizes: ${measured} measured, ${entries.size - measured} estimated`);
