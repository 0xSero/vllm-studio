import { constants, existsSync, statfsSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Effect, Semaphore } from "effect";
import {
  CHATTERBOX_BACKEND,
  CHATTERBOX_MODEL_REVISION,
  CHATTERBOX_PACKAGE_VERSION,
  type SpeechGpuTarget,
  type SpeechStatus,
  type SpeechVoiceProfile,
} from "@local-studio/contracts/speech";
import type { ProcessInfo, Recipe, GpuInfo } from "../models/types";
import {
  GpuLeaseConflict,
  type GpuLeaseRegistry,
  resolveRecipeGpuUuids,
} from "../system/gpu-leases";
import { resolveBinary } from "../../core/command";
import {
  ChatterboxRuntime,
  chatterboxRuntimePaths,
  type ChatterboxInstallOptions,
  type ChatterboxRuntimeState,
} from "./runtime";
import {
  ChatterboxWorkerClient,
  type ChatterboxSynthesisInput,
  type ChatterboxSynthesisResult,
} from "./worker-client";
import {
  normalizeVoiceReference,
  VoiceReferenceError,
  type NormalizedVoiceReference,
} from "./reference-audio";
import { VoiceStore, type VoiceProfile } from "./voice-store";
import { secureSpeechDirectory } from "./storage";
import { queryNvidiaComputeGpuUuids } from "../system/platform/nvidia-compute-processes";

const FULL_NVIDIA_UUID =
  /^GPU-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const RTX_3090_NAME = /\bRTX\s+3090\b/i;
const MANAGED_INSTALL_BYTES = 32 * 1024 ** 3;
const MINIMUM_FREE_RESERVE_BYTES = 8 * 1024 ** 3;
const REQUIRED_INSTALL_BYTES = MANAGED_INSTALL_BYTES + MINIMUM_FREE_RESERVE_BYTES;
const MAXIMUM_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_QUEUED_SYNTHESIS = 4;
const MAXIMUM_PENDING_NORMALIZATION = 2;
const MAXIMUM_TEXT_CHARACTERS = 4096;

export class SpeechServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SpeechServiceError";
  }
}

export interface SpeechEngineState {
  getCurrentProcess(): Promise<ProcessInfo | null>;
  getCurrentRecipe(): Promise<Recipe | null>;
}

export interface SpeechRuntime {
  readonly paths: { readonly pythonPath: string };
  getState(): ChatterboxRuntimeState;
  startInstall(gpuUuid: string, options?: ChatterboxInstallOptions): ChatterboxRuntimeState;
  waitForInstall(): Promise<ChatterboxRuntimeState>;
  cancelInstall(): Promise<void>;
}

export interface SpeechWorker {
  synthesize(input: ChatterboxSynthesisInput): Promise<ChatterboxSynthesisResult>;
  shutdown(): Promise<void>;
  settleTermination(): Promise<void>;
  terminate(): Promise<void>;
}

const speechGpuLeaseBrand: unique symbol = Symbol("SpeechGpuLeaseGuard");

export interface SpeechGpuLeaseGuard {
  readonly uuid: string;
  readonly generation: number;
  readonly [speechGpuLeaseBrand]: true;
}

export interface SpeechVoiceStore {
  list(): VoiceProfile[];
  create(input: {
    name: string;
    durationMs: number;
    consent: string;
    audio: Uint8Array;
  }): Promise<VoiceProfile>;
  delete(id: string): Promise<boolean>;
  withPlaintext<A>(id: string, use: (path: string) => Promise<A>): Promise<A>;
}

export interface SpeechDiskAvailability {
  readonly totalBytes: number;
  readonly availableBytes: number;
}

export interface SpeechSynthesisInput {
  readonly text: string;
  readonly voiceId: string;
}

export interface SpeechSynthesisOutput {
  readonly audio: Uint8Array;
  readonly contentType: "audio/wav";
  readonly sampleRate: number;
}

export interface SpeechVoiceInput {
  readonly name: string;
  readonly consent: string;
  readonly audio: Uint8Array;
}

export interface SpeechInstallInput {
  readonly repair?: boolean | undefined;
}

export interface SpeechServiceOptions {
  readonly dataDirectory: string;
  readonly databasePath: string;
  readonly engine: SpeechEngineState;
  readonly gpuLeaseRegistry: GpuLeaseRegistry;
  readonly gpuInfo: () => GpuInfo[];
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly runtime?: SpeechRuntime | undefined;
  readonly voiceStore?: SpeechVoiceStore | undefined;
  readonly workerFactory?: ((lease: SpeechGpuLeaseGuard) => SpeechWorker) | undefined;
  readonly normalizeReference?:
    ((input: Uint8Array, dataDirectory: string) => Promise<NormalizedVoiceReference>) | undefined;
  readonly diskAvailability?: (() => SpeechDiskAvailability | null) | undefined;
  readonly resolveBinary?: ((name: string) => string | null) | undefined;
  readonly computeGpuUuids?: (() => Promise<readonly string[]>) | undefined;
}

const canonicalUuid = (uuid: string): string => `GPU-${uuid.slice(4).toLowerCase()}`;

const serviceError = (error: unknown, status = 500, code = "speech_failed"): SpeechServiceError =>
  error instanceof SpeechServiceError
    ? error
    : new SpeechServiceError(status, code, error instanceof Error ? error.message : String(error));

const installationMessage = (state: ChatterboxRuntimeState): string => {
  if (state.status === "not_installed") return "Chatterbox Turbo is not installed";
  if (state.status === "installed") return "Chatterbox Turbo is ready";
  if (state.status === "error") return state.message;
  if (state.stage === "preparing") return "Preparing Chatterbox Turbo";
  if (state.stage === "creating_runtime") return "Creating the speech runtime";
  if (state.stage === "installing_package") return "Installing Chatterbox Turbo";
  return "Downloading the pinned Chatterbox Turbo model";
};

const installationStatus = (state: ChatterboxRuntimeState): SpeechStatus["install"] => {
  if (state.status === "not_installed") {
    return { phase: "missing", progress: 0, message: installationMessage(state), error: null };
  }
  if (state.status === "installed") {
    return { phase: "ready", progress: 1, message: installationMessage(state), error: null };
  }
  if (state.status === "error") {
    return { phase: "failed", progress: 0, message: state.message, error: state.message };
  }
  return {
    phase: "installing",
    progress: state.progress,
    message: installationMessage(state),
    error: null,
  };
};

const diskAvailability = (path: string): SpeechDiskAvailability | null => {
  try {
    const stats = statfsSync(path);
    return {
      totalBytes: stats.blocks * stats.bsize,
      availableBytes: stats.bavail * stats.bsize,
    };
  } catch {
    return null;
  }
};

const outputChildPath = (directory: string, path: string): string => {
  const root = resolve(directory);
  const candidate = resolve(path);
  const child = relative(root, candidate);
  if (!child || child.startsWith("..") || child.startsWith("/") || child.startsWith("\\")) {
    throw new SpeechServiceError(502, "speech_output_invalid", "Speech worker output is invalid");
  }
  return candidate;
};

const validatedWave = (audio: Uint8Array): Uint8Array => {
  const bytes = Buffer.from(audio);
  if (
    bytes.length < 44 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    throw new SpeechServiceError(502, "speech_output_invalid", "Speech worker output is invalid");
  }
  return bytes;
};

const readBoundedWave = async (path: string): Promise<Uint8Array> => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAXIMUM_OUTPUT_BYTES) {
      throw new SpeechServiceError(502, "speech_output_invalid", "Speech worker output is invalid");
    }
    const bytes = Buffer.alloc(Math.min(MAXIMUM_OUTPUT_BYTES + 1, stats.size + 1));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > MAXIMUM_OUTPUT_BYTES) {
      throw new SpeechServiceError(502, "speech_output_invalid", "Speech worker output is invalid");
    }
    const completed = await handle.stat();
    if (completed.size !== offset) {
      throw new SpeechServiceError(502, "speech_output_invalid", "Speech worker output is invalid");
    }
    return validatedWave(Buffer.from(bytes.subarray(0, offset)));
  } finally {
    await handle.close();
  }
};

const validText = (text: string): string => {
  if (!text.trim())
    throw new SpeechServiceError(400, "speech_text_required", "Speech text is required");
  if (Array.from(text).length > MAXIMUM_TEXT_CHARACTERS) {
    throw new SpeechServiceError(
      400,
      "speech_text_too_long",
      `Speech text cannot exceed ${MAXIMUM_TEXT_CHARACTERS} characters`,
    );
  }
  return text;
};

const stoppingError = (): SpeechServiceError =>
  new SpeechServiceError(409, "speech_stopping", "Speech runtime is stopping");

export class SpeechService {
  private readonly dataDirectory: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly runtime: SpeechRuntime;
  private readonly voiceStore: SpeechVoiceStore;
  private readonly workerFactory: (lease: SpeechGpuLeaseGuard) => SpeechWorker;
  private readonly normalizeReference: (
    input: Uint8Array,
    dataDirectory: string,
  ) => Promise<NormalizedVoiceReference>;
  private readonly getDiskAvailability: () => SpeechDiskAvailability | null;
  private readonly findBinary: (name: string) => string | null;
  private readonly computeGpuUuids: () => Promise<readonly string[]>;
  private readonly outputDirectory: string;
  private readonly activation = Semaphore.makeUnsafe(1);
  private readonly synthesis = Semaphore.makeUnsafe(1);
  private readonly voiceNormalization = Semaphore.makeUnsafe(1);
  private worker: SpeechWorker | null = null;
  private workerPhase: SpeechStatus["worker"]["phase"] = "stopped";
  private workerError: string | null = null;
  private leasedGpuUuid: string | null = null;
  private liveLease: SpeechGpuLeaseGuard | null = null;
  private leaseGeneration = 0;
  private quarantined = false;
  private pendingSynthesis = 0;
  private pendingNormalization = 0;
  private acceptingSynthesis = true;
  private synthesisEpoch = 0;
  private installTask: Promise<void> | null = null;
  private cancellingInstall = false;
  private stopTask: Promise<void> | null = null;

  constructor(private readonly options: SpeechServiceOptions) {
    this.environment = options.environment ?? process.env;
    this.dataDirectory = resolve(
      this.environment["LOCAL_STUDIO_SPEECH_DATA_DIR"] ?? options.dataDirectory,
    );
    const paths = chatterboxRuntimePaths(this.dataDirectory);
    this.outputDirectory = paths.outputDirectory;
    secureSpeechDirectory(paths.speechDirectory);
    this.runtime = options.runtime ?? new ChatterboxRuntime({ dataDirectory: this.dataDirectory });
    this.voiceStore =
      options.voiceStore ?? new VoiceStore(options.databasePath, this.dataDirectory);
    this.workerFactory =
      options.workerFactory ??
      ((lease): SpeechWorker =>
        new ChatterboxWorkerClient({
          dataDirectory: this.dataDirectory,
          gpuUuid: lease.uuid,
          voiceDirectory: join(this.dataDirectory, "runtime", "speech", "tmp"),
        }));
    this.normalizeReference = options.normalizeReference ?? normalizeVoiceReference;
    this.getDiskAvailability =
      options.diskAvailability ??
      ((): SpeechDiskAvailability | null => diskAvailability(this.dataDirectory));
    this.findBinary = options.resolveBinary ?? resolveBinary;
    this.computeGpuUuids = options.computeGpuUuids ?? queryNvidiaComputeGpuUuids;
  }

  getStatus(): SpeechStatus {
    const target = this.statusTarget();
    const storage = this.getDiskAvailability();
    return {
      backend: CHATTERBOX_BACKEND,
      package_version: CHATTERBOX_PACKAGE_VERSION,
      model_revision: CHATTERBOX_MODEL_REVISION,
      install: installationStatus(this.runtime.getState()),
      worker: {
        phase: this.workerPhase,
        queue_depth: Math.max(0, this.pendingSynthesis - 1),
        error: this.workerError,
      },
      gpu: target,
      prerequisites: {
        ffmpeg: Boolean(this.findBinary(this.environment["LOCAL_STUDIO_FFMPEG_CLI"] ?? "ffmpeg")),
        python_311: Boolean(
          existsSync(this.runtime.paths.pythonPath) ||
          this.findBinary("python3.11") ||
          this.findBinary("uv"),
        ),
        storage: {
          available_bytes: storage?.availableBytes ?? null,
          required_bytes: REQUIRED_INSTALL_BYTES,
          ready: Boolean(storage && storage.availableBytes >= REQUIRED_INSTALL_BYTES),
        },
      },
      voice_count: this.voiceStore.list().length,
    };
  }

  install(input: SpeechInstallInput = {}): Promise<SpeechStatus> {
    if (this.stopTask) return Promise.reject(stoppingError());
    const state = this.runtime.getState();
    if (state.status === "installing" || (state.status === "installed" && !input.repair)) {
      return Promise.resolve(this.getStatus());
    }
    return Effect.runPromise(
      this.activation.withPermit(
        Effect.tryPromise({
          try: async () => {
            const current = this.runtime.getState();
            if (
              current.status === "installing" ||
              (current.status === "installed" && !input.repair)
            ) {
              return this.getStatus();
            }
            if (input.repair && this.worker) {
              await this.stopRuntime(false, true);
            }
            this.assertInstallCapacity();
            const lease = await this.activateSpeech();
            await this.assertLiveLease(lease);
            let started: ChatterboxRuntimeState;
            try {
              started = this.startRuntimeInstall(lease, input);
            } catch (error) {
              if (!this.worker) await this.releaseSpeechLease();
              throw error;
            }
            if (started.status !== "installing") {
              if (!this.worker) await this.releaseSpeechLease();
              if (started.status === "error") {
                throw new SpeechServiceError(500, "speech_install_failed", started.message);
              }
              return this.getStatus();
            }
            this.startInstallCompletion(lease);
            return this.getStatus();
          },
          catch: (error) => serviceError(error, 500, "speech_install_failed"),
        }),
      ),
    );
  }

  listVoices(): SpeechVoiceProfile[] {
    return this.voiceStore.list();
  }

  createVoice(input: SpeechVoiceInput): Promise<SpeechVoiceProfile> {
    if (this.pendingNormalization >= MAXIMUM_PENDING_NORMALIZATION) {
      return Promise.reject(
        new VoiceReferenceError(429, "voice_queue_full", "Voice normalization queue is full"),
      );
    }
    this.pendingNormalization += 1;
    return Effect.runPromise(
      this.voiceNormalization
        .withPermit(
          Effect.tryPromise({
            try: async () => {
              const normalized = await this.normalizeReference(input.audio, this.dataDirectory);
              return this.voiceStore.create({
                name: input.name,
                consent: input.consent,
                audio: normalized.audio,
                durationMs: normalized.durationMs,
              });
            },
            catch: (error) => error,
          }),
        )
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              this.pendingNormalization -= 1;
            }),
          ),
        ),
    );
  }

  deleteVoice(id: string): Promise<boolean> {
    return this.voiceStore.delete(id);
  }

  synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisOutput> {
    if (!this.acceptingSynthesis) {
      return Promise.reject(stoppingError());
    }
    if (this.pendingSynthesis >= MAXIMUM_QUEUED_SYNTHESIS + 1) {
      return Promise.reject(
        new SpeechServiceError(429, "speech_queue_full", "Speech queue is full"),
      );
    }
    this.pendingSynthesis += 1;
    const epoch = this.synthesisEpoch;
    const operation = this.synthesis.withPermit(
      Effect.suspend(() =>
        epoch === this.synthesisEpoch
          ? Effect.tryPromise({
              try: () => this.synthesizeOne(input, epoch),
              catch: (error) => error,
            })
          : Effect.fail(stoppingError()),
      ),
    );
    return Effect.runPromise(
      operation.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.pendingSynthesis -= 1;
          }),
        ),
      ),
    );
  }

  stop(): Promise<void> {
    if (this.installTask) {
      return Promise.reject(
        new SpeechServiceError(
          409,
          "speech_installing",
          "Wait for the Chatterbox install to finish before stopping speech",
        ),
      );
    }
    return this.stopRuntime(false, true);
  }

  cancelInstall(): Promise<void> {
    if (!this.installTask) return Promise.resolve();
    return this.stopRuntime(true, true);
  }

  shutdown(): Promise<void> {
    return this.stopRuntime(true, false);
  }

  private statusTarget(): SpeechGpuTarget | null {
    try {
      return this.resolveTarget(this.options.gpuInfo());
    } catch {
      return null;
    }
  }

  private resolveTarget(gpus: readonly GpuInfo[]): SpeechGpuTarget {
    if (gpus.length === 0) {
      throw new SpeechServiceError(
        503,
        "speech_gpu_telemetry_missing",
        "GPU telemetry is unavailable",
      );
    }
    const configured = this.environment["LOCAL_STUDIO_SPEECH_GPU_UUID"]?.trim();
    if (configured) {
      if (!FULL_NVIDIA_UUID.test(configured)) {
        throw new SpeechServiceError(
          400,
          "speech_gpu_invalid",
          "LOCAL_STUDIO_SPEECH_GPU_UUID must be a full NVIDIA GPU UUID",
        );
      }
      const uuid = canonicalUuid(configured);
      const gpu = gpus.find((candidate) => candidate.uuid?.toLowerCase() === uuid.toLowerCase());
      if (!gpu) {
        throw new SpeechServiceError(
          503,
          "speech_gpu_missing",
          "The configured speech GPU is unavailable",
        );
      }
      return {
        uuid,
        name: gpu.name,
        ...(gpu.pci_bus_id ? { pci_bus_id: gpu.pci_bus_id } : {}),
      };
    }
    const matches = gpus.filter((gpu) => RTX_3090_NAME.test(gpu.name));
    if (matches.length !== 1) {
      throw new SpeechServiceError(
        503,
        "speech_gpu_ambiguous",
        "Configure one RTX 3090 for speech with LOCAL_STUDIO_SPEECH_GPU_UUID",
      );
    }
    const gpu = matches[0];
    if (!gpu?.uuid || !FULL_NVIDIA_UUID.test(gpu.uuid)) {
      throw new SpeechServiceError(
        503,
        "speech_gpu_telemetry_missing",
        "GPU UUID telemetry is unavailable",
      );
    }
    return {
      uuid: canonicalUuid(gpu.uuid),
      name: gpu.name,
      ...(gpu.pci_bus_id ? { pci_bus_id: gpu.pci_bus_id } : {}),
    };
  }

  private assertInstallCapacity(): void {
    const availability = this.getDiskAvailability();
    if (!availability) {
      throw new SpeechServiceError(
        503,
        "speech_storage_unavailable",
        "Speech storage capacity could not be verified",
      );
    }
    if (availability.availableBytes < REQUIRED_INSTALL_BYTES) {
      throw new SpeechServiceError(
        507,
        "speech_storage_low",
        `Chatterbox requires ${REQUIRED_INSTALL_BYTES / 1024 ** 3} GB of available speech storage`,
      );
    }
  }

  private async activateSpeech(): Promise<SpeechGpuLeaseGuard> {
    if (this.quarantined) {
      throw new SpeechServiceError(
        503,
        "speech_worker_quarantined",
        "Speech GPU remains reserved until the previous worker exits",
      );
    }
    const gpus = this.options.gpuInfo();
    const target = this.resolveTarget(gpus);
    if (this.leasedGpuUuid && this.leasedGpuUuid !== target.uuid) {
      throw new SpeechServiceError(
        409,
        "speech_gpu_changed",
        "Stop the speech runtime before changing its GPU",
      );
    }
    const existing = this.liveLease;
    if (this.installTask && existing?.uuid === target.uuid) {
      await this.assertLiveLease(existing);
      return existing;
    }
    await this.assertComputeGpuIdle(target.uuid);
    await this.reconcileModelLeases(gpus);
    try {
      await Effect.runPromise(this.options.gpuLeaseRegistry.claim("speech", [target.uuid]));
    } catch (error) {
      throw error instanceof GpuLeaseConflict
        ? new SpeechServiceError(409, "speech_gpu_busy", "The speech GPU is in use by a model")
        : serviceError(error, 409, "speech_gpu_unavailable");
    }
    this.leasedGpuUuid = target.uuid;
    const lease = {
      uuid: target.uuid,
      generation: ++this.leaseGeneration,
      [speechGpuLeaseBrand]: true,
    } satisfies SpeechGpuLeaseGuard;
    this.liveLease = lease;
    try {
      await this.assertComputeGpuIdle(target.uuid);
    } catch (error) {
      await this.releaseSpeechLease();
      throw error;
    }
    return lease;
  }

  private async assertComputeGpuIdle(uuid: string): Promise<void> {
    let occupied: readonly string[];
    try {
      occupied = await this.computeGpuUuids();
    } catch {
      throw new SpeechServiceError(
        503,
        "speech_gpu_compute_query_failed",
        "Could not verify speech GPU compute processes",
      );
    }
    if (occupied.some((candidate) => candidate.toLowerCase() === uuid.toLowerCase())) {
      throw new SpeechServiceError(
        409,
        "speech_gpu_compute_busy",
        "The speech GPU already has an unmanaged compute process",
      );
    }
  }

  private async assertLiveLease(lease: SpeechGpuLeaseGuard): Promise<void> {
    this.assertRetainedLease(lease);
    const leases = await Effect.runPromise(this.options.gpuLeaseRegistry.snapshot());
    if (!leases.some((current) => current.owner === "speech" && current.uuid === lease.uuid)) {
      this.liveLease = null;
      this.leasedGpuUuid = null;
      throw new SpeechServiceError(409, "speech_lease_expired", "Speech GPU lease expired");
    }
  }

  private assertRetainedLease(lease: SpeechGpuLeaseGuard): void {
    if (this.liveLease !== lease || this.leasedGpuUuid !== lease.uuid) {
      throw new SpeechServiceError(409, "speech_lease_expired", "Speech GPU lease expired");
    }
  }

  private startRuntimeInstall(
    lease: SpeechGpuLeaseGuard,
    options: SpeechInstallInput,
  ): ChatterboxRuntimeState {
    this.assertRetainedLease(lease);
    return this.runtime.startInstall(lease.uuid, options);
  }

  private async reconcileModelLeases(gpus: readonly GpuInfo[]): Promise<void> {
    const process = await this.options.engine.getCurrentProcess();
    if (!process) {
      const leases = await Effect.runPromise(this.options.gpuLeaseRegistry.snapshot());
      if (leases.some((lease) => lease.owner === "llm")) {
        throw new SpeechServiceError(
          409,
          "model_gpu_transition",
          "A model GPU transition is still in progress",
        );
      }
      return;
    }
    const recipe = await this.options.engine.getCurrentRecipe();
    const confirmed = await this.options.engine.getCurrentProcess();
    if (!confirmed || confirmed.pid !== process.pid) {
      throw new SpeechServiceError(
        409,
        "model_process_changed",
        "The active model changed while speech was preparing",
      );
    }
    if (!recipe) {
      throw new SpeechServiceError(
        409,
        "model_process_unknown",
        `Running model process ${process.pid} does not match a managed recipe`,
      );
    }
    const resolution = resolveRecipeGpuUuids(recipe, gpus);
    if (resolution.unresolvedTokens.length > 0) {
      throw new SpeechServiceError(
        409,
        "model_gpu_unresolved",
        `Model GPU selectors could not be resolved: ${resolution.unresolvedTokens.join(", ")}`,
      );
    }
    if (resolution.uuids.length === 0) {
      throw new SpeechServiceError(
        503,
        "model_gpu_telemetry_missing",
        "Model GPU isolation could not be verified",
      );
    }
    try {
      await Effect.runPromise(this.options.gpuLeaseRegistry.replace("llm", resolution.uuids));
    } catch (error) {
      throw error instanceof GpuLeaseConflict
        ? new SpeechServiceError(
            409,
            "model_gpu_conflict",
            "The active model overlaps the speech GPU",
          )
        : serviceError(error, 409, "model_gpu_unavailable");
    }
  }

  private ensureWorker(): Promise<SpeechWorker> {
    return Effect.runPromise(
      this.activation.withPermit(
        Effect.tryPromise({
          try: async () => {
            const runtimeState = this.runtime.getState();
            if (runtimeState.status === "installing") {
              throw new SpeechServiceError(
                409,
                "speech_installing",
                "Chatterbox Turbo is still installing",
              );
            }
            if (runtimeState.status !== "installed") {
              throw new SpeechServiceError(
                409,
                "speech_not_installed",
                "Install Chatterbox Turbo before generating speech",
              );
            }
            if (this.worker) {
              if (this.quarantined) {
                throw new SpeechServiceError(
                  503,
                  "speech_worker_quarantined",
                  "Speech GPU remains reserved until the previous worker exits",
                );
              }
              const lease = this.liveLease;
              if (!lease)
                throw new SpeechServiceError(
                  409,
                  "speech_lease_expired",
                  "Speech GPU lease expired",
                );
              await this.assertLiveLease(lease);
              return this.worker;
            }
            const lease = await this.activateSpeech();
            await this.assertLiveLease(lease);
            this.workerPhase = "starting";
            this.workerError = null;
            try {
              this.assertRetainedLease(lease);
              this.worker = this.workerFactory(lease);
              return this.worker;
            } catch (error) {
              this.workerPhase = "failed";
              this.workerError = error instanceof Error ? error.message : String(error);
              await this.releaseSpeechLease();
              throw error;
            }
          },
          catch: (error) => serviceError(error),
        }).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (this.worker) return;
              this.workerPhase = "failed";
              this.workerError = error.message;
            }),
          ),
        ),
      ),
    );
  }

  private async synthesizeOne(
    input: SpeechSynthesisInput,
    epoch: number,
  ): Promise<SpeechSynthesisOutput> {
    const text = validText(input.text);
    return this.voiceStore.withPlaintext(input.voiceId, async (voicePath) => {
      this.assertSynthesisEpoch(epoch);
      const worker = await this.ensureWorker();
      this.assertSynthesisEpoch(epoch);
      this.workerPhase = "busy";
      this.workerError = null;
      let result: ChatterboxSynthesisResult;
      try {
        result = await worker.synthesize({ text, voicePath });
      } catch (error) {
        if (epoch !== this.synthesisEpoch) throw stoppingError();
        this.quarantineWorker(error);
        throw error;
      }
      let output: string | null = null;
      try {
        this.assertSynthesisEpoch(epoch);
        output = outputChildPath(this.outputDirectory, result.path);
        const audio = await readBoundedWave(output);
        this.workerPhase = "ready";
        return { audio, contentType: "audio/wav", sampleRate: result.sampleRate };
      } catch (error) {
        if (epoch !== this.synthesisEpoch) throw stoppingError();
        this.quarantineWorker(error);
        throw error;
      } finally {
        if (output) await unlink(output).catch(() => undefined);
      }
    });
  }

  private quarantineWorker(error: unknown): void {
    this.quarantined = true;
    this.workerPhase = "failed";
    this.workerError = error instanceof Error ? error.message : String(error);
  }

  private assertSynthesisEpoch(epoch: number): void {
    if (!this.acceptingSynthesis || epoch !== this.synthesisEpoch) throw stoppingError();
  }

  private async terminateWorker(worker: SpeechWorker): Promise<void> {
    try {
      await worker.terminate();
    } catch (error) {
      this.quarantineWorker(error);
      throw new SpeechServiceError(
        503,
        "speech_worker_exit_unconfirmed",
        "Speech GPU remains reserved because the worker exit was not confirmed",
      );
    }
  }

  private async stopWorker(): Promise<void> {
    const activeWorker = this.worker;
    if (activeWorker) await this.terminateWorker(activeWorker);
    await Effect.runPromise(this.synthesis.withPermit(Effect.void));
    const lateWorker = this.worker;
    if (lateWorker && lateWorker !== activeWorker) await this.terminateWorker(lateWorker);
    this.worker = null;
    this.quarantined = false;
    await this.releaseSpeechLease();
    this.workerPhase = "stopped";
    this.workerError = null;
  }

  private stopRuntime(cancelInstall: boolean, restoreSynthesis: boolean): Promise<void> {
    const existing = this.stopTask;
    if (existing) {
      if (!restoreSynthesis) {
        this.acceptingSynthesis = false;
        this.synthesisEpoch += 1;
        return Effect.runPromise(
          Effect.tryPromise({ try: () => existing, catch: (error) => error }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                this.acceptingSynthesis = false;
              }),
            ),
          ),
        );
      }
      return existing;
    }
    this.acceptingSynthesis = false;
    this.synthesisEpoch += 1;
    if (cancelInstall) this.cancellingInstall = true;
    const installation = this.installTask;
    const operation = Effect.tryPromise({
      try: async () => {
        if (cancelInstall) {
          await this.runtime.cancelInstall();
          await installation;
        }
        await this.stopWorker();
      },
      catch: (error) =>
        serviceError(error, 503, cancelInstall ? "speech_shutdown_failed" : "speech_stop_failed"),
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (cancelInstall) this.cancellingInstall = false;
          if (restoreSynthesis) this.acceptingSynthesis = true;
        }),
      ),
    );
    const task = Effect.runPromise(operation);
    this.stopTask = task;
    task.then(
      () => {
        if (this.stopTask === task) this.stopTask = null;
      },
      () => {
        if (this.stopTask === task) this.stopTask = null;
      },
    );
    return task;
  }

  private async releaseSpeechLease(): Promise<void> {
    const uuid = this.leasedGpuUuid;
    if (!uuid) return;
    await Effect.runPromise(this.options.gpuLeaseRegistry.release("speech", [uuid]));
    this.leasedGpuUuid = null;
    this.liveLease = null;
  }

  private startInstallCompletion(lease: SpeechGpuLeaseGuard): void {
    const completion = Effect.tryPromise({
      try: () => this.runtime.waitForInstall(),
      catch: (error) => serviceError(error, 500, "speech_install_failed"),
    }).pipe(
      Effect.flatMap((state) =>
        state.status === "installed" || state.status === "error"
          ? Effect.void
          : Effect.fail(
              new SpeechServiceError(
                500,
                "speech_install_failed",
                "Chatterbox install did not finish",
              ),
            ),
      ),
      Effect.ensuring(
        this.activation
          .withPermit(
            Effect.tryPromise({
              try: async () => {
                if (this.liveLease === lease && !this.worker && !this.cancellingInstall) {
                  await this.releaseSpeechLease();
                }
              },
              catch: (error) => serviceError(error, 500, "speech_lease_release_failed"),
            }),
          )
          .pipe(Effect.orDie),
      ),
    );
    const task = Effect.runPromise(completion);
    this.installTask = task;
    task.then(
      () => {
        if (this.installTask === task) this.installTask = null;
      },
      (error: unknown) => {
        if (this.installTask === task) this.installTask = null;
        this.workerError = error instanceof Error ? error.message : String(error);
      },
    );
  }
}
