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
