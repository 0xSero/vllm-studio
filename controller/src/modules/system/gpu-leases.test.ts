import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { asRecipeId, type GpuInfo, type Recipe } from "../models/types";
import {
  createGpuLeaseRegistry,
  GpuLeaseConflict,
  GpuLeaseLockFailure,
  resolveRecipeGpuUuids,
  type GpuLease,
} from "./gpu-leases";

const proUuids = [
  "GPU-00000000-0000-0000-0000-000000000001",
  "GPU-00000000-0000-0000-0000-000000000002",
  "GPU-00000000-0000-0000-0000-000000000003",
  "GPU-00000000-0000-0000-0000-000000000004",
] as const;
const rtxUuid = "GPU-00000000-0000-0000-0000-000000003090";

const temporaryLockDirectory = (): Promise<string> =>
  mkdtemp(join(tmpdir(), "local-studio-gpu-leases-test-"));

const lockPath = (directory: string, uuid: string): string =>
  join(directory, `${uuid.toLowerCase()}.lock`);

const writeHostLock = async (
  directory: string,
  uuid: string,
  pid: number,
  processStartToken: string | null,
): Promise<void> => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    lockPath(directory, uuid),
    JSON.stringify({
      version: 1,
      uuid,
      owner: "speech",
      pid,
      processStartToken,
      registryId: "stale-registry",
    }),
    { mode: 0o600 },
  );
};

function gpu(index: number, name: string, uuid: string): GpuInfo {
  return {
    uuid,
    index,
    name,
    memory_total_mb: 96_000,
    memory_used_mb: 0,
    memory_free_mb: 96_000,
    utilization_pct: 0,
    temp_c: 30,
    power_draw: 0,
    power_limit: 0,
  };
}

function recipe(
  environmentVariables: Record<string, string> | null = null,
  extraArguments: Record<string, unknown> = {},
): Recipe {
  return {
    id: asRecipeId("gpu-lease-test"),
    name: "GPU lease test",
    model_path: "model",
    vision: null,
    backend: "vllm",
    runtime: { kind: "managed_venv", ref: "vllm-latest" },
    env_vars: environmentVariables,
    tensor_parallel_size: 1,
    pipeline_parallel_size: 1,
    max_model_len: 4096,
    gpu_memory_utilization: 0.9,
    kv_cache_dtype: "auto",
    max_num_seqs: 1,
    trust_remote_code: false,
    tool_call_parser: null,
    reasoning_parser: null,
    enable_auto_tool_choice: false,
    quantization: null,
    dtype: null,
    host: "127.0.0.1",
    port: 8000,
    served_model_name: null,
    python_path: null,
    extra_args: extraArguments,
    max_thinking_tokens: null,
    thinking_mode: "auto",
  };
}

function fiveGpuHost(): GpuInfo[] {
  return [
    ...proUuids.slice(0, 3).map((uuid, index) => gpu(index, "NVIDIA RTX PRO 6000 Blackwell", uuid)),
    gpu(3, "NVIDIA GeForce RTX 3090", rtxUuid),
    gpu(4, "NVIDIA RTX PRO 6000 Blackwell", proUuids[3]),
  ];
}

test("resolves the four PRO recipe without leasing the 3090", () => {
  const resolution = resolveRecipeGpuUuids(
    recipe({ CUDA_VISIBLE_DEVICES: "0,1,2,4" }),
    fiveGpuHost(),
  );

  expect(resolution).toEqual({
    source: "recipe",
    selector: "0,1,2,4",
    uuids: [...proUuids],
    unresolvedTokens: [],
  });
});

test("reports an atomic all-GPU lease conflict", async () => {
  const registry = createGpuLeaseRegistry();
  const allUuids = resolveRecipeGpuUuids(recipe(), fiveGpuHost()).uuids;
  await Effect.runPromise(registry.claim("llm", proUuids));
  await Effect.runPromise(registry.claim("speech", [rtxUuid]));

  try {
    await Effect.runPromise(registry.replace("llm", allUuids));
    throw new Error("expected a GPU lease conflict");
  } catch (error) {
    expect(error).toBeInstanceOf(GpuLeaseConflict);
    if (error instanceof GpuLeaseConflict) {
      expect(error.requestedBy).toBe("llm");
      expect(error.conflicts).toEqual([{ uuid: rtxUuid, heldBy: "speech" }]);
    }
  }
  const unchanged: GpuLease[] = [
    ...proUuids.map((uuid): GpuLease => ({ uuid, owner: "llm" })),
    { uuid: rtxUuid, owner: "speech" },
  ];
  expect(await Effect.runPromise(registry.snapshot())).toEqual(unchanged);
});

test("keeps UUID selectors stable when GPU indices reorder", () => {
  const reordered = [
    gpu(0, "NVIDIA RTX PRO 6000 Blackwell", proUuids[3]),
    gpu(4, "NVIDIA RTX PRO 6000 Blackwell", proUuids[0]),
  ];
  const selector = `${proUuids[0]},${proUuids[3]}`;

  expect(
    resolveRecipeGpuUuids(recipe({ CUDA_VISIBLE_DEVICES: selector }), reordered).uuids,
  ).toEqual([proUuids[0], proUuids[3]]);
});

test("reports unresolved aliased selectors without falling back", () => {
  const resolution = resolveRecipeGpuUuids(
    recipe(null, { "cuda-visible-devices": `${proUuids[1]},99` }),
    fiveGpuHost(),
  );

  expect(resolution.uuids).toEqual([proUuids[1]]);
  expect(resolution.unresolvedTokens).toEqual(["99"]);
});

test("replaces and releases only the requesting owner leases", async () => {
  const registry = createGpuLeaseRegistry();
  await Effect.runPromise(registry.claim("llm", [proUuids[0], proUuids[1]]));
  await Effect.runPromise(registry.claim("speech", [rtxUuid]));
  await Effect.runPromise(registry.replace("llm", [proUuids[2], proUuids[3]]));
  await Effect.runPromise(registry.release("speech"));
  await Effect.runPromise(registry.release("llm", [proUuids[2]]));

  expect(await Effect.runPromise(registry.snapshot())).toEqual([
    { uuid: proUuids[3], owner: "llm" },
  ]);
});

test("conflicts across registries in the same live process", async () => {
  const directory = await temporaryLockDirectory();
  const first = createGpuLeaseRegistry({ lockDirectory: directory });
  const second = createGpuLeaseRegistry({ lockDirectory: directory });
  try {
    await Effect.runPromise(first.claim("speech", [rtxUuid]));
    expect(await Effect.runPromise(first.claim("speech", [rtxUuid]))).toEqual([
      { uuid: rtxUuid, owner: "speech" },
    ]);
    try {
      await Effect.runPromise(second.claim("speech", [rtxUuid]));
      throw new Error("expected a cross-registry GPU lease conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(GpuLeaseConflict);
      if (error instanceof GpuLeaseConflict) {
        expect(error.conflicts).toEqual([{ uuid: rtxUuid, heldBy: "speech" }]);
      }
    }
    await Effect.runPromise(first.release("speech"));
    expect(await Effect.runPromise(second.claim("speech", [rtxUuid]))).toEqual([
      { uuid: rtxUuid, owner: "speech" },
    ]);
  } finally {
    await Effect.runPromise(first.release("speech"));
    await Effect.runPromise(second.release("speech"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("reclaims a lock from a dead process", async () => {
  const directory = await temporaryLockDirectory();
  const registry = createGpuLeaseRegistry({ lockDirectory: directory });
  try {
    await writeHostLock(directory, rtxUuid, 2_147_483_647, "1");
    expect(await Effect.runPromise(registry.claim("speech", [rtxUuid]))).toEqual([
      { uuid: rtxUuid, owner: "speech" },
    ]);
  } finally {
    await Effect.runPromise(registry.release("speech"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("reclaims a reused Linux PID by process start token", async () => {
  if (process.platform !== "linux") return;
  const directory = await temporaryLockDirectory();
  const registry = createGpuLeaseRegistry({ lockDirectory: directory });
  try {
    await writeHostLock(directory, rtxUuid, process.pid, "0");
    expect(await Effect.runPromise(registry.claim("speech", [rtxUuid]))).toEqual([
      { uuid: rtxUuid, owner: "speech" },
    ]);
  } finally {
    await Effect.runPromise(registry.release("speech"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails closed on an unverifiable host lock record", async () => {
  const directory = await temporaryLockDirectory();
  const registry = createGpuLeaseRegistry({ lockDirectory: directory });
  try {
    await writeFile(lockPath(directory, rtxUuid), "not-json", { mode: 0o600 });
    await expect(Effect.runPromise(registry.claim("speech", [rtxUuid]))).rejects.toBeInstanceOf(
      GpuLeaseLockFailure,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovers a stale reaper left during dead-lock reclamation", async () => {
  const directory = await temporaryLockDirectory();
  const registry = createGpuLeaseRegistry({ lockDirectory: directory });
  const reaper = `${lockPath(directory, rtxUuid)}.reaper`;
  try {
    await writeHostLock(directory, rtxUuid, 2_147_483_647, "1");
    await mkdir(reaper, { mode: 0o700 });
    const old = new Date(Date.now() - 10_000);
    await utimes(reaper, old, old);
    expect(await Effect.runPromise(registry.claim("speech", [rtxUuid]))).toEqual([
      { uuid: rtxUuid, owner: "speech" },
    ]);
  } finally {
    await Effect.runPromise(registry.release("speech"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("rolls back new host locks before a failed replacement", async () => {
  const directory = await temporaryLockDirectory();
  const primary = createGpuLeaseRegistry({ lockDirectory: directory });
  const blocker = createGpuLeaseRegistry({ lockDirectory: directory });
  const probe = createGpuLeaseRegistry({ lockDirectory: directory });
  try {
    await Effect.runPromise(primary.claim("llm", [proUuids[0], proUuids[1]]));
    await Effect.runPromise(blocker.claim("speech", [rtxUuid]));
    try {
      await Effect.runPromise(primary.replace("llm", [proUuids[2], rtxUuid]));
      throw new Error("expected a replacement GPU lease conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(GpuLeaseConflict);
    }
    expect(await Effect.runPromise(primary.snapshot())).toEqual([
      { uuid: proUuids[0], owner: "llm" },
      { uuid: proUuids[1], owner: "llm" },
    ]);
    await Effect.runPromise(probe.claim("llm", [proUuids[2]]));
    await Effect.runPromise(probe.release("llm"));
    await Effect.runPromise(blocker.release("speech"));
    await Effect.runPromise(primary.replace("llm", [proUuids[2], rtxUuid]));
    expect(await Effect.runPromise(probe.claim("speech", [proUuids[0], proUuids[1]]))).toEqual([
      { uuid: proUuids[0], owner: "speech" },
      { uuid: proUuids[1], owner: "speech" },
    ]);
  } finally {
    await Effect.runPromise(primary.release("llm"));
    await Effect.runPromise(blocker.release("speech"));
    await Effect.runPromise(probe.release("llm"));
    await Effect.runPromise(probe.release("speech"));
    await rm(directory, { recursive: true, force: true });
  }
});
