import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { parseRecipe } from "../models/recipes/recipe-serializer";
import type { GpuInfo, ProcessInfo, Recipe } from "../models/types";
import { createGpuLeaseRegistry, type GpuLeaseRegistry } from "../system/gpu-leases";
import type { ChatterboxRuntimeState } from "./runtime";
import type { ChatterboxInstallOptions } from "./runtime";
import {
  SpeechService,
  SpeechServiceError,
  type SpeechDiskAvailability,
  type SpeechEngineState,
  type SpeechGpuLeaseGuard,
  type SpeechRuntime,
  type SpeechVoiceStore,
  type SpeechWorker,
} from "./service";
import type { ChatterboxSynthesisInput, ChatterboxSynthesisResult } from "./worker-client";
import type { VoiceProfile } from "./voice-store";

const PRO_UUIDS = [
  "GPU-00000000-0000-0000-0000-000000000001",
  "GPU-00000000-0000-0000-0000-000000000002",
  "GPU-00000000-0000-0000-0000-000000000003",
  "GPU-00000000-0000-0000-0000-000000000004",
] as const;
const SPEECH_UUID = "GPU-00000000-0000-0000-0000-000000003090";
const INSTALLED: ChatterboxRuntimeState = {
  status: "installed",
  packageVersion: "0.1.7",
  modelRevision: "749d1c1a46eb10492095d68fbcf55691ccf137cd",
  gpuUuid: SPEECH_UUID,
  installedAt: "2026-07-09T12:00:00.000Z",
};

const gpu = (index: number, uuid: string, name: string): GpuInfo => ({
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
});

const gpus = (): GpuInfo[] => [
  gpu(0, PRO_UUIDS[0], "NVIDIA RTX PRO 6000 Blackwell"),
  gpu(1, PRO_UUIDS[1], "NVIDIA RTX PRO 6000 Blackwell"),
  gpu(2, PRO_UUIDS[2], "NVIDIA RTX PRO 6000 Blackwell"),
  gpu(3, SPEECH_UUID, "NVIDIA GeForce RTX 3090"),
  gpu(4, PRO_UUIDS[3], "NVIDIA RTX PRO 6000 Blackwell"),
];

const modelRecipe = (selector = "0,1,2,4"): Recipe =>
  parseRecipe({
    id: "speech-test-model",
    name: "Speech test model",
    model_path: "/models/speech-test",
    env_vars: { CUDA_VISIBLE_DEVICES: selector },
  });

const processInfo = (): ProcessInfo => ({
  pid: 8123,
  backend: "vllm",
  model_path: "/models/speech-test",
  port: 8000,
  served_model_name: null,
});

class FakeRuntime implements SpeechRuntime {
  readonly paths: { readonly pythonPath: string };
  installCalls = 0;
  cancelCalls = 0;
  cancelError: Error | null = null;
  startError: Error | null = null;
  private resolveInstall: ((state: ChatterboxRuntimeState) => void) | null = null;
  private installPromise: Promise<ChatterboxRuntimeState> | null = null;

  constructor(
    directory: string,
    private state: ChatterboxRuntimeState = INSTALLED,
  ) {
    this.paths = { pythonPath: join(directory, "runtime", "bin", "python") };
  }

  getState(): ChatterboxRuntimeState {
    return this.state;
  }

  startInstall(gpuUuid: string, options: ChatterboxInstallOptions = {}): ChatterboxRuntimeState {
    if (
      this.state.status === "installing" ||
      (this.state.status === "installed" && !options.repair)
    ) {
      return this.state;
    }
    this.installCalls += 1;
    if (this.startError) throw this.startError;
    this.state = {
      status: "installing",
      stage: "prefetching_model",
      progress: 0.75,
      gpuUuid,
    };
    this.installPromise = new Promise((resolve) => {
      this.resolveInstall = resolve;
    });
    return this.state;
  }

  waitForInstall(): Promise<ChatterboxRuntimeState> {
    return this.installPromise ?? Promise.resolve(this.state);
  }

  cancelInstall(): Promise<void> {
    this.cancelCalls += 1;
    if (this.state.status === "installing") {
      this.state = {
        status: "error",
        gpuUuid: this.state.gpuUuid,
        message: "Chatterbox install cancelled",
      };
      this.resolveInstall?.(this.state);
      this.resolveInstall = null;
    }
    return this.cancelError ? Promise.reject(this.cancelError) : Promise.resolve();
  }

  finishInstall(): void {
    this.state = INSTALLED;
    this.resolveInstall?.(this.state);
    this.resolveInstall = null;
  }
}

class FakeVoiceStore implements SpeechVoiceStore {
  readonly profiles: VoiceProfile[] = [
    {
      id: "voice_00000000000000000000000000000000",
      name: "Sero",
      duration_ms: 10_000,
      created_at: "2026-07-09T12:00:00.000Z",
    },
  ];
  plaintextError: Error | null = null;

  constructor(private readonly referencePath: string) {}

  list(): VoiceProfile[] {
    return [...this.profiles];
  }

  create(input: {
    name: string;
    durationMs: number;
    consent: string;
    audio: Uint8Array;
  }): Promise<VoiceProfile> {
    const profile = {
      id: "voice_11111111111111111111111111111111",
      name: input.name,
      duration_ms: input.durationMs,
      created_at: "2026-07-09T13:00:00.000Z",
    } satisfies VoiceProfile;
    this.profiles.push(profile);
    return Promise.resolve(profile);
  }

  delete(id: string): Promise<boolean> {
    const index = this.profiles.findIndex((profile) => profile.id === id);
    if (index < 0) return Promise.resolve(false);
    this.profiles.splice(index, 1);
    return Promise.resolve(true);
  }

  withPlaintext<A>(_id: string, use: (path: string) => Promise<A>): Promise<A> {
    if (this.plaintextError) return Promise.reject(this.plaintextError);
    return use(this.referencePath);
  }
}

const wave = (): Buffer => {
  const bytes = Buffer.alloc(46);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(38, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(2, 40);
  return bytes;
};

class FakeWorker implements SpeechWorker {
  shutdownError: Error | null = null;
  settleError: Error | null = null;
  terminateError: Error | null = null;
  terminateCalls = 0;
  synthesizeStarted = 0;
  private blocker: Promise<void> | null = null;
  private releaseBlocker: (() => void) | null = null;
  private rejectBlocker: ((error: Error) => void) | null = null;
  outputBytes: Uint8Array = wave();

  constructor(private readonly outputPath: string) {}

  blockSynthesis(): void {
    this.blocker = new Promise((resolve, reject) => {
      this.releaseBlocker = resolve;
      this.rejectBlocker = reject;
    });
  }

  releaseSynthesis(): void {
    this.releaseBlocker?.();
    this.releaseBlocker = null;
    this.rejectBlocker = null;
    this.blocker = null;
  }

  async synthesize(_input: ChatterboxSynthesisInput): Promise<ChatterboxSynthesisResult> {
    this.synthesizeStarted += 1;
    await this.blocker;
    mkdirSync(join(this.outputPath, ".."), { recursive: true });
    writeFileSync(this.outputPath, this.outputBytes);
    return { path: this.outputPath, sampleRate: 24_000 };
  }

  shutdown(): Promise<void> {
    return this.shutdownError ? Promise.reject(this.shutdownError) : Promise.resolve();
  }

  settleTermination(): Promise<void> {
    return this.settleError ? Promise.reject(this.settleError) : Promise.resolve();
  }

  terminate(): Promise<void> {
    this.terminateCalls += 1;
    if (this.terminateError) return Promise.reject(this.terminateError);
    this.rejectBlocker?.(new Error("Speech operation was interrupted"));
    this.rejectBlocker = null;
    this.releaseBlocker = null;
    this.blocker = null;
    return Promise.resolve();
  }
}

const stableEngine = (recipe: Recipe | null = modelRecipe()): SpeechEngineState => ({
  getCurrentProcess: async () => processInfo(),
  getCurrentRecipe: async () => recipe,
});

const noModelEngine = (): SpeechEngineState => ({
  getCurrentProcess: async () => null,
  getCurrentRecipe: async () => null,
});

const readyDisk = (): SpeechDiskAvailability => ({
  totalBytes: 256 * 1024 ** 3,
  availableBytes: 80 * 1024 ** 3,
});

const fixture = (
  overrides: {
    runtime?: SpeechRuntime;
    engine?: SpeechEngineState;
    registry?: GpuLeaseRegistry;
    workerFactory?: (lease: SpeechGpuLeaseGuard) => SpeechWorker;
    diskAvailability?: () => SpeechDiskAvailability | null;
    gpuInfo?: () => GpuInfo[];
    environment?: NodeJS.ProcessEnv;
    normalizeReference?: (
      input: Uint8Array,
      dataDirectory: string,
    ) => Promise<{ audio: Uint8Array; durationMs: number }>;
    computeGpuUuids?: () => Promise<readonly string[]>;
  } = {},
): {
  directory: string;
  registry: GpuLeaseRegistry;
  runtime: SpeechRuntime;
  worker: FakeWorker;
  voiceStore: FakeVoiceStore;
  service: SpeechService;
} => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-service-"));
  const output = join(directory, "runtime", "speech", "outputs", "result.wav");
  const reference = join(directory, "reference.wav");
  writeFileSync(reference, wave());
  const registry = overrides.registry ?? createGpuLeaseRegistry();
  const runtime = overrides.runtime ?? new FakeRuntime(directory);
  const worker = new FakeWorker(output);
  const voiceStore = new FakeVoiceStore(reference);
  const service = new SpeechService({
    dataDirectory: directory,
    databasePath: join(directory, "controller.db"),
    engine: overrides.engine ?? stableEngine(),
    gpuLeaseRegistry: registry,
    gpuInfo: overrides.gpuInfo ?? gpus,
    runtime,
    voiceStore,
    workerFactory: overrides.workerFactory ?? ((): SpeechWorker => worker),
    diskAvailability: overrides.diskAvailability ?? readyDisk,
    environment: overrides.environment ?? {},
    ...(overrides.normalizeReference ? { normalizeReference: overrides.normalizeReference } : {}),
    computeGpuUuids: overrides.computeGpuUuids ?? (async (): Promise<readonly string[]> => []),
    resolveBinary: (name): string | null => (name === "uv" ? "/opt/uv" : null),
  });
  return { directory, registry, runtime, worker, voiceStore, service };
};

const speechFailure = async (promise: Promise<unknown>): Promise<SpeechServiceError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SpeechServiceError) return error;
    throw error;
  }
  throw new Error("Expected speech operation to fail");
};

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Expected test condition was not reached");
};

test("seeds model leases and presents a live speech lease before spawning the worker", async () => {
  const factoryLeases: SpeechGpuLeaseGuard[] = [];
  const created = fixture({
    workerFactory: (lease): SpeechWorker => {
      factoryLeases.push(lease);
      return created.worker;
    },
  });
  try {
    const output = await created.service.synthesize({
      text: "Local speech is isolated",
      voiceId: "voice_00000000000000000000000000000000",
    });

    expect(output.audio).toEqual(wave());
    expect(factoryLeases[0]?.uuid).toBe(SPEECH_UUID);
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([
      ...PRO_UUIDS.map((uuid) => ({ uuid, owner: "llm" as const })),
      { uuid: SPEECH_UUID, owner: "speech" },
    ]);
    expect(existsSync(join(created.directory, "runtime", "speech", "outputs", "result.wav"))).toBe(
      false,
    );
  } finally {
    await created.service.stop().catch(() => undefined);
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("blocks unknown and unresolved model processes before claiming speech", async () => {
  const unknown = fixture({ engine: stableEngine(null) });
  const unresolved = fixture({ engine: stableEngine(modelRecipe("0,missing")) });
  try {
    expect(
      (
        await speechFailure(
          unknown.service.synthesize({
            text: "Blocked",
            voiceId: "voice_00000000000000000000000000000000",
          }),
        )
      ).code,
    ).toBe("model_process_unknown");
    expect(
      (
        await speechFailure(
          unresolved.service.synthesize({
            text: "Blocked",
            voiceId: "voice_00000000000000000000000000000000",
          }),
        )
      ).code,
    ).toBe("model_gpu_unresolved");
    expect(await Effect.runPromise(unknown.registry.snapshot())).toEqual([]);
    expect(await Effect.runPromise(unresolved.registry.snapshot())).toEqual([]);
  } finally {
    rmSync(unknown.directory, { recursive: true, force: true });
    rmSync(unresolved.directory, { recursive: true, force: true });
  }
});

test("accepts an explicit full UUID and fails closed when UUID telemetry is missing", async () => {
  const renamedGpus = (): GpuInfo[] =>
    gpus().map((candidate) =>
      candidate.uuid === SPEECH_UUID
        ? { ...candidate, name: "NVIDIA dedicated speech GPU" }
        : candidate,
    );
  const configured = fixture({
    engine: noModelEngine(),
    gpuInfo: renamedGpus,
    environment: { LOCAL_STUDIO_SPEECH_GPU_UUID: SPEECH_UUID },
  });
  const missing = fixture({
    engine: noModelEngine(),
    gpuInfo: () =>
      gpus().map((candidate) => {
        const withoutUuid = { ...candidate };
        delete withoutUuid.uuid;
        return withoutUuid;
      }),
  });
  try {
    expect(configured.service.getStatus().gpu?.uuid).toBe(SPEECH_UUID);
    await configured.service.synthesize({
      text: "Explicit target",
      voiceId: "voice_00000000000000000000000000000000",
    });
    expect(missing.service.getStatus().gpu).toBeNull();
    expect(
      (
        await speechFailure(
          missing.service.synthesize({
            text: "No telemetry",
            voiceId: "voice_00000000000000000000000000000000",
          }),
        )
      ).code,
    ).toBe("speech_gpu_telemetry_missing");
    expect(await Effect.runPromise(missing.registry.snapshot())).toEqual([]);
  } finally {
    await configured.service.stop().catch(() => undefined);
    rmSync(configured.directory, { recursive: true, force: true });
    rmSync(missing.directory, { recursive: true, force: true });
  }
});

test("does not steal an in-flight model lease before its process appears", async () => {
  const registry = createGpuLeaseRegistry();
  await Effect.runPromise(registry.claim("llm", [SPEECH_UUID]));
  const created = fixture({ registry, engine: noModelEngine() });
  try {
    const error = await speechFailure(
      created.service.synthesize({
        text: "Blocked",
        voiceId: "voice_00000000000000000000000000000000",
      }),
    );
    expect(error.code).toBe("model_gpu_transition");
    expect(await Effect.runPromise(registry.snapshot())).toEqual([
      { uuid: SPEECH_UUID, owner: "llm" },
    ]);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("blocks an orphan compute process before reserving the speech GPU", async () => {
  let workerCreations = 0;
  const created = fixture({
    engine: noModelEngine(),
    computeGpuUuids: async () => [SPEECH_UUID],
    workerFactory: (): SpeechWorker => {
      workerCreations += 1;
      return created.worker;
    },
  });
  try {
    const error = await speechFailure(
      created.service.synthesize({
        text: "Do not overlap this process",
        voiceId: "voice_00000000000000000000000000000000",
      }),
    );
    expect(error.code).toBe("speech_gpu_compute_busy");
    expect(workerCreations).toBe(0);
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([]);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("releases admission when the post-lease compute query fails", async () => {
  let queries = 0;
  const created = fixture({
    engine: noModelEngine(),
    computeGpuUuids: async () => {
      queries += 1;
      if (queries === 1) return [];
      throw new Error("nvidia-smi failed");
    },
  });
  try {
    const error = await speechFailure(
      created.service.synthesize({
        text: "Fail closed",
        voiceId: "voice_00000000000000000000000000000000",
      }),
    );
    expect(error.code).toBe("speech_gpu_compute_query_failed");
    expect(queries).toBe(2);
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([]);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("does not activate speech when the managed voice cannot be decrypted", async () => {
  let workerCreations = 0;
  const created = fixture({
    engine: noModelEngine(),
    workerFactory: (): SpeechWorker => {
      workerCreations += 1;
      return created.worker;
    },
  });
  created.voiceStore.plaintextError = new Error("Voice profile authentication failed");
  try {
    await expect(
      created.service.synthesize({
        text: "Do not reserve a GPU",
        voiceId: "voice_00000000000000000000000000000000",
      }),
    ).rejects.toThrow("Voice profile authentication failed");
    expect(workerCreations).toBe(0);
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([]);
    expect(created.service.getStatus().worker).toEqual({
      phase: "stopped",
      queue_depth: 0,
      error: null,
    });
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("starts install without waiting and holds the opaque lease through prefetch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-install-runtime-"));
  const runtime = new FakeRuntime(directory, { status: "not_installed" });
  let computeQueries = 0;
  const created = fixture({
    runtime,
    engine: noModelEngine(),
    computeGpuUuids: async () => {
      computeQueries += 1;
      return [];
    },
  });
  try {
    const status = await created.service.install();
    expect(status.install.phase).toBe("installing");
    expect(runtime.installCalls).toBe(1);
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([
      { uuid: SPEECH_UUID, owner: "speech" },
    ]);
    expect(status.prerequisites.python_311).toBe(true);
    expect((await created.service.install()).install.phase).toBe("installing");
    expect(runtime.installCalls).toBe(1);
    expect(computeQueries).toBe(2);
    expect(created.service.getStatus().install.phase).toBe("installing");
    expect(
      (
        await speechFailure(
          created.service.synthesize({
            text: "Not until install finishes",
            voiceId: "voice_00000000000000000000000000000000",
          }),
        )
      ).code,
    ).toBe("speech_installing");
    expect((await speechFailure(created.service.stop())).code).toBe("speech_installing");
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([
      { uuid: SPEECH_UUID, owner: "speech" },
    ]);

    runtime.finishInstall();
    await created.service.shutdown();
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([]);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cancels background installation on shutdown before releasing its lease", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-cancel-install-runtime-"));
  const runtime = new FakeRuntime(directory, { status: "not_installed" });
  const created = fixture({ runtime, engine: noModelEngine() });
  try {
    expect((await created.service.install()).install.phase).toBe("installing");
    await created.service.shutdown();
    expect(runtime.cancelCalls).toBe(1);
    expect(runtime.getState()).toMatchObject({
      status: "error",
      message: "Chatterbox install cancelled",
    });
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([]);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps the speech lease when install process exit cannot be confirmed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-cancel-uncertain-runtime-"));
  const runtime = new FakeRuntime(directory, { status: "not_installed" });
  const created = fixture({ runtime, engine: noModelEngine() });
  try {
    await created.service.install();
    runtime.cancelError = new Error("Command process exit could not be confirmed");
    expect((await speechFailure(created.service.shutdown())).code).toBe("speech_shutdown_failed");
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([
      { uuid: SPEECH_UUID, owner: "speech" },
    ]);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("explicitly repairs an installed runtime while no speech worker is active", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-repair-runtime-"));
  const runtime = new FakeRuntime(directory);
  const created = fixture({ engine: noModelEngine(), runtime });
  try {
    const status = await created.service.install({ repair: true });
    expect(status.install.phase).toBe("installing");
    expect(runtime.getState().status).toBe("installing");
    expect(runtime.installCalls).toBe(1);
    runtime.finishInstall();
    await created.service.shutdown();
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stops the live speech worker before repair", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-repair-active-runtime-"));
  const runtime = new FakeRuntime(directory);
  const created = fixture({ engine: noModelEngine(), runtime });
  try {
    await created.service.synthesize({
      text: "Keep this worker live",
      voiceId: "voice_00000000000000000000000000000000",
    });
    const status = await created.service.install({ repair: true });
    expect(status.install.phase).toBe("installing");
    expect(created.worker.terminateCalls).toBe(1);
    expect(runtime.installCalls).toBe(1);
    runtime.finishInstall();
  } finally {
    await created.service.stop().catch(() => undefined);
    rmSync(created.directory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cancels background installation on explicit request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-user-cancel-runtime-"));
  const runtime = new FakeRuntime(directory, { status: "not_installed" });
  const created = fixture({ runtime, engine: noModelEngine() });
  try {
    await created.service.install();
    await created.service.cancelInstall();
    expect(runtime.cancelCalls).toBe(1);
    expect(created.service.getStatus().install.phase).toBe("failed");
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([]);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reports structured low storage and rejects install before leasing the GPU", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-low-disk-runtime-"));
  const runtime = new FakeRuntime(directory, { status: "not_installed" });
  const created = fixture({
    runtime,
    engine: noModelEngine(),
    diskAvailability: () => ({
      totalBytes: 2 * 1024 ** 4,
      availableBytes: 39 * 1024 ** 3,
    }),
  });
  try {
    const status = created.service.getStatus();
    expect(status.prerequisites.storage.available_bytes).toBe(39 * 1024 ** 3);
    expect(status.prerequisites.storage.required_bytes).toBe(40 * 1024 ** 3);
    expect(status.prerequisites.storage.ready).toBe(false);
    expect((await speechFailure(created.service.install())).code).toBe("speech_storage_low");
    expect(runtime.installCalls).toBe(0);
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([]);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts the fixed speech storage budget with 46 GB available", () => {
  const created = fixture({
    diskAvailability: () => ({
      totalBytes: 2 * 1024 ** 4,
      availableBytes: 46 * 1024 ** 3,
    }),
  });
  try {
    expect(created.service.getStatus().prerequisites.storage).toEqual({
      available_bytes: 46 * 1024 ** 3,
      required_bytes: 40 * 1024 ** 3,
      ready: true,
    });
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("releases the speech lease when runtime startup fails before prefetch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-start-failure-runtime-"));
  const runtime = new FakeRuntime(directory, { status: "not_installed" });
  runtime.startError = new Error("runtime could not start");
  const created = fixture({ runtime, engine: noModelEngine() });
  try {
    expect((await speechFailure(created.service.install())).message).toBe(
      "runtime could not start",
    );
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([]);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("allows one active synthesis and four queued before rejecting admission", async () => {
  const created = fixture({ engine: noModelEngine() });
  created.worker.blockSynthesis();
  const requests = Array.from({ length: 5 }, (_, index) =>
    created.service.synthesize({
      text: `Queued request ${index}`,
      voiceId: "voice_00000000000000000000000000000000",
    }),
  );
  try {
    expect(created.service.getStatus().worker.queue_depth).toBe(4);
    expect(
      (
        await speechFailure(
          created.service.synthesize({
            text: "One too many",
            voiceId: "voice_00000000000000000000000000000000",
          }),
        )
      ).code,
    ).toBe("speech_queue_full");
    created.worker.releaseSynthesis();
    await Promise.all(requests);
    expect(created.worker.synthesizeStarted).toBe(5);
  } finally {
    created.worker.releaseSynthesis();
    await Promise.allSettled(requests);
    await created.service.stop().catch(() => undefined);
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("stop terminates active synthesis and rejects every queued request", async () => {
  const created = fixture({ engine: noModelEngine() });
  created.worker.blockSynthesis();
  const requests = Array.from({ length: 4 }, (_, index) =>
    created.service.synthesize({
      text: `Stop request ${index}`,
      voiceId: "voice_00000000000000000000000000000000",
    }),
  );
  const failures = requests.map(speechFailure);
  try {
    await waitFor(() => created.worker.synthesizeStarted === 1);
    const stopping = created.service.stop();
    await Promise.resolve();
    expect(created.worker.terminateCalls).toBe(1);
    expect((await Promise.all(failures)).map(({ code }) => code)).toEqual([
      "speech_stopping",
      "speech_stopping",
      "speech_stopping",
      "speech_stopping",
    ]);
    await stopping;
    expect(created.worker.synthesizeStarted).toBe(1);
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([]);
    expect(created.service.getStatus().worker.phase).toBe("stopped");
  } finally {
    created.worker.releaseSynthesis();
    await Promise.allSettled(requests);
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("reuses a live speech worker despite an unrelated stale model lease", async () => {
  const created = fixture({ engine: noModelEngine() });
  try {
    await created.service.synthesize({
      text: "Warm the worker",
      voiceId: "voice_00000000000000000000000000000000",
    });
    await Effect.runPromise(created.registry.claim("llm", [PRO_UUIDS[0]]));

    await created.service.synthesize({
      text: "Reuse the worker",
      voiceId: "voice_00000000000000000000000000000000",
    });
    expect(created.worker.synthesizeStarted).toBe(2);
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([
      { uuid: PRO_UUIDS[0], owner: "llm" },
      { uuid: SPEECH_UUID, owner: "speech" },
    ]);
  } finally {
    await created.service.stop().catch(() => undefined);
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("quarantines an unconfirmed worker exit without releasing its GPU", async () => {
  const created = fixture({ engine: noModelEngine() });
  try {
    await created.service.synthesize({
      text: "Reserve this GPU",
      voiceId: "voice_00000000000000000000000000000000",
    });
    created.worker.terminateError = new Error("exit unconfirmed");

    expect((await speechFailure(created.service.stop())).code).toBe(
      "speech_worker_exit_unconfirmed",
    );
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([
      { uuid: SPEECH_UUID, owner: "speech" },
    ]);
    expect(created.service.getStatus().worker.phase).toBe("failed");
    expect(
      (
        await speechFailure(
          created.service.synthesize({
            text: "Do not reuse it",
            voiceId: "voice_00000000000000000000000000000000",
          }),
        )
      ).code,
    ).toBe("speech_worker_quarantined");
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("removes invalid worker output and quarantines the live lease", async () => {
  const created = fixture({ engine: noModelEngine() });
  created.worker.outputBytes = new Uint8Array([1, 2, 3]);
  const output = join(created.directory, "runtime", "speech", "outputs", "result.wav");
  try {
    expect(
      (
        await speechFailure(
          created.service.synthesize({
            text: "Validate this output",
            voiceId: "voice_00000000000000000000000000000000",
          }),
        )
      ).code,
    ).toBe("speech_output_invalid");
    expect(existsSync(output)).toBe(false);
    expect(await Effect.runPromise(created.registry.snapshot())).toEqual([
      { uuid: SPEECH_UUID, owner: "speech" },
    ]);
    expect(created.service.getStatus().worker.phase).toBe("failed");
  } finally {
    await created.service.stop().catch(() => undefined);
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("normalizes voice creation and delegates list and deletion", async () => {
  const created = fixture({ engine: noModelEngine() });
  const service = new SpeechService({
    dataDirectory: created.directory,
    databasePath: join(created.directory, "controller.db"),
    engine: noModelEngine(),
    gpuLeaseRegistry: created.registry,
    gpuInfo: gpus,
    runtime: created.runtime,
    voiceStore: new FakeVoiceStore(join(created.directory, "reference.wav")),
    normalizeReference: async (): Promise<{ audio: Uint8Array; durationMs: number }> => ({
      audio: wave(),
      durationMs: 8_500,
    }),
    diskAvailability: readyDisk,
    environment: {},
    resolveBinary: (): null => null,
  });
  try {
    const profile = await service.createVoice({
      name: "My voice",
      consent: "self_voice_v1",
      audio: new Uint8Array([1, 2, 3]),
    });
    expect(profile.duration_ms).toBe(8_500);
    expect(service.listVoices()).toHaveLength(2);
    expect(await service.deleteVoice(profile.id)).toBe(true);
    expect(service.listVoices()).toHaveLength(1);
  } finally {
    rmSync(created.directory, { recursive: true, force: true });
  }
});

test("admits one active and one queued voice normalization", async () => {
  const releases: Array<() => void> = [];
  const gate = new Promise<void>((resolve) => releases.push(resolve));
  let normalizations = 0;
  const created = fixture({
    normalizeReference: async () => {
      normalizations += 1;
      await gate;
      return { audio: wave(), durationMs: 8_500 };
    },
  });
  const create = (): Promise<VoiceProfile> =>
    created.service.createVoice({
      name: "Queued voice",
      consent: "self_voice_v1",
      audio: new Uint8Array([1, 2, 3]),
    });
  const first = create();
  const second = create();
  try {
    await expect(create()).rejects.toMatchObject({ code: "voice_queue_full", status: 429 });
    await waitFor(() => normalizations === 1);
    expect(normalizations).toBe(1);
    releases.shift()?.();
    await Promise.all([first, second]);
    expect(normalizations).toBe(2);
  } finally {
    releases.splice(0).forEach((release) => release());
    await Promise.allSettled([first, second]);
    rmSync(created.directory, { recursive: true, force: true });
  }
});
