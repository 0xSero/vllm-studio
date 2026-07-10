import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, Schema } from "effect";
import {
  CHATTERBOX_BACKEND,
  CHATTERBOX_MODEL_REVISION,
  CHATTERBOX_PACKAGE_VERSION,
} from "@local-studio/contracts/speech";
import {
  ChatterboxWorkerClient,
  SpeechWorkerError,
  SpeechWorkerRequestSchema,
  spawnNodeSpeechWorker,
  type SpeechWorkerRequest,
  type SpeechWorkerSpawnOptions,
  type SpeechWorkerTransport,
} from "./worker-client";
import { chatterboxRuntimePaths } from "./runtime";

const GPU_UUID = "GPU-01234567-89ab-cdef-0123-456789abcdef";

class FakeTransport implements SpeechWorkerTransport {
  readonly writes: string[] = [];
  killed = false;
  inputClosed = false;
  exitOnClose = true;
  exitOnKill = true;
  closeFailure: Error | null = null;
  onWrite: ((request: SpeechWorkerRequest) => void) | null = null;
  private exited = false;
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly stderrListeners = new Set<(line: string) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >();

  write(line: string): void {
    this.writes.push(line);
    const request = Schema.decodeUnknownSync(SpeechWorkerRequestSchema)(JSON.parse(line));
    this.onWrite?.(request);
  }

  closeInput(): void {
    this.inputClosed = true;
    if (this.closeFailure) throw this.closeFailure;
    if (this.exitOnClose) queueMicrotask(() => this.emitExit(0, null));
  }

  kill(): void {
    this.killed = true;
    if (this.exitOnKill) queueMicrotask(() => this.emitExit(null, "SIGKILL"));
  }

  onLine(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  onStderr(listener: (line: string) => void): () => void {
    this.stderrListeners.add(listener);
    return () => this.stderrListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  emitLine(value: unknown): void {
    const line = typeof value === "string" ? value : JSON.stringify(value);
    this.lineListeners.forEach((listener) => listener(line));
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitListeners.forEach((listener) => listener(code, signal));
  }
}

const readyFrame = {
  type: "ready",
  backend: CHATTERBOX_BACKEND,
  package_version: CHATTERBOX_PACKAGE_VERSION,
  model_revision: CHATTERBOX_MODEL_REVISION,
  cuda_devices: 1,
  sample_rate: 24000,
} as const;

const fixture = (): { directory: string; voicePath: string; workerPath: string } => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-worker-"));
  const workerPath = join(directory, "worker.py");
  const paths = chatterboxRuntimePaths(directory, workerPath);
  const voicePath = join(paths.voiceDirectory, "voice.wav");
  mkdirSync(paths.voiceDirectory, { recursive: true });
  writeFileSync(workerPath, "");
  writeFileSync(voicePath, "voice");
  return { directory, voicePath, workerPath };
};

const speechError = async (promise: Promise<unknown>): Promise<SpeechWorkerError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SpeechWorkerError) return error;
    throw error;
  }
  throw new Error("Expected speech operation to fail");
};

test("pins the worker environment and frames synthesize and shutdown requests", async () => {
  const { directory, voicePath, workerPath } = fixture();
  const transport = new FakeTransport();
  const spawns: SpeechWorkerSpawnOptions[] = [];
  const ids = ["speech-one", "shutdown-one"];
  try {
    transport.onWrite = (request): void => {
      if (request.type === "synthesize") {
        transport.emitLine({
          type: "synthesize",
          id: request.id,
          output_path: request.output_path,
          sample_rate: 24000,
        });
      } else {
        transport.emitLine({ type: "shutdown", id: request.id });
      }
    };
    const client = new ChatterboxWorkerClient({
      dataDirectory: directory,
      gpuUuid: GPU_UUID,
      workerPath,
      randomId: (): string => ids.shift() ?? "unused",
      environment: {
        PATH: "/usr/bin",
        LOCAL_STUDIO_API_KEY: "controller-secret",
        HF_TOKEN: "hub-secret",
      },
      spawnWorker: (options): SpeechWorkerTransport => {
        spawns.push(options);
        queueMicrotask(() => transport.emitLine(readyFrame));
        return transport;
      },
    });

    const result = await client.synthesize({ text: "Hello from Local Studio", voicePath });
    expect(result.sampleRate).toBe(24000);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.command).toBe(client.paths.pythonPath);
    expect(spawns[0]?.args).toEqual(["-u", workerPath]);
    expect(spawns[0]?.env["CUDA_VISIBLE_DEVICES"]).toBe(GPU_UUID);
    expect(spawns[0]?.env["CUDA_DEVICE_ORDER"]).toBe("PCI_BUS_ID");
    expect(spawns[0]?.env["HF_HOME"]).toBe(client.paths.cacheDirectory);
    expect(spawns[0]?.env["LOCAL_STUDIO_API_KEY"]).toBeUndefined();
    expect(spawns[0]?.env["HF_TOKEN"]).toBeUndefined();
    expect(spawns[0]?.env["LOCAL_STUDIO_SPEECH_VOICES_DIR"]).toBeUndefined();
    expect(spawns[0]?.env["LOCAL_STUDIO_SPEECH_OUTPUTS_DIR"]).toBeUndefined();
    expect(transport.writes[0]?.endsWith("\n")).toBe(true);
    expect(JSON.parse(transport.writes[0] ?? "")).toEqual({
      type: "synthesize",
      id: "speech-one",
      text: "Hello from Local Studio",
      voice_path: realpathSync(voicePath),
      output_path: result.path,
    });

    await client.shutdown();
    expect(JSON.parse(transport.writes[1] ?? "")).toEqual({
      type: "shutdown",
      id: "shutdown-one",
    });
    expect(transport.inputClosed).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fails an exited request once and restarts only on the next explicit call", async () => {
  const { directory, voicePath, workerPath } = fixture();
  const firstTransport = new FakeTransport();
  const secondTransport = new FakeTransport();
  const transports = [firstTransport, secondTransport];
  let spawnCount = 0;
  try {
    firstTransport.onWrite = (request): void => {
      if (request.type === "synthesize") firstTransport.emitExit(1, null);
    };
    secondTransport.onWrite = (request): void => {
      if (request.type === "synthesize") {
        secondTransport.emitLine({
          type: "synthesize",
          id: request.id,
          output_path: request.output_path,
          sample_rate: 24000,
        });
      }
    };
    const client = new ChatterboxWorkerClient({
      dataDirectory: directory,
      gpuUuid: GPU_UUID,
      workerPath,
      randomId: (): string => `speech-${spawnCount}`,
      spawnWorker: (): SpeechWorkerTransport => {
        const transport = transports[spawnCount];
        if (!transport) throw new Error("Unexpected worker spawn");
        spawnCount += 1;
        queueMicrotask(() => transport.emitLine(readyFrame));
        return transport;
      },
    });

    const firstError = await speechError(client.synthesize({ text: "First", voicePath }));
    expect(firstError.message).toContain("exited with code 1");
    expect(spawnCount).toBe(1);
    expect(firstTransport.writes).toHaveLength(1);

    expect((await client.synthesize({ text: "Second", voicePath })).sampleRate).toBe(24000);
    expect(spawnCount).toBe(2);
    expect(firstTransport.writes).toHaveLength(1);
    expect(secondTransport.writes).toHaveLength(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not finish shutdown until the worker has released its process", async () => {
  const { directory, voicePath, workerPath } = fixture();
  const transport = new FakeTransport();
  transport.exitOnClose = false;
  transport.exitOnKill = false;
  try {
    transport.onWrite = (request): void => {
      if (request.type === "synthesize") {
        transport.emitLine({
          type: "synthesize",
          id: request.id,
          output_path: request.output_path,
          sample_rate: 24000,
        });
      } else {
        transport.emitLine({ type: "shutdown", id: request.id });
      }
    };
    const ids = ["lease-speech", "lease-shutdown"];
    const client = new ChatterboxWorkerClient({
      dataDirectory: directory,
      gpuUuid: GPU_UUID,
      workerPath,
      randomId: (): string => ids.shift() ?? "unused",
      shutdownGraceMs: 1_000,
      spawnWorker: (): SpeechWorkerTransport => {
        queueMicrotask(() => transport.emitLine(readyFrame));
        return transport;
      },
    });
    await client.synthesize({ text: "Lease safe", voicePath });

    let settled = false;
    const shutdown = client.shutdown().then((): void => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(transport.inputClosed).toBe(true);
    expect(settled).toBe(false);

    transport.emitExit(0, null);
    await shutdown;
    expect(settled).toBe(true);
    expect(transport.killed).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("kills a timed out worker without replaying the request", async () => {
  const { directory, voicePath, workerPath } = fixture();
  const transport = new FakeTransport();
  try {
    const client = new ChatterboxWorkerClient({
      dataDirectory: directory,
      gpuUuid: GPU_UUID,
      workerPath,
      randomId: (): string => "speech-timeout",
      synthesisTimeoutMs: 10,
      spawnWorker: (): SpeechWorkerTransport => {
        queueMicrotask(() => transport.emitLine(readyFrame));
        return transport;
      },
    });

    const error = await speechError(client.synthesize({ text: "Wait forever", voicePath }));
    expect(error.code).toBe("timeout");
    expect(transport.killed).toBe(true);
    expect(transport.writes).toHaveLength(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shutdown settles an earlier killed worker before the lease can be released", async () => {
  const { directory, voicePath, workerPath } = fixture();
  const transport = new FakeTransport();
  transport.exitOnKill = false;
  try {
    const client = new ChatterboxWorkerClient({
      dataDirectory: directory,
      gpuUuid: GPU_UUID,
      workerPath,
      randomId: (): string => "speech-termination",
      synthesisTimeoutMs: 10,
      shutdownKillTimeoutMs: 1_000,
      spawnWorker: (): SpeechWorkerTransport => {
        queueMicrotask(() => transport.emitLine(readyFrame));
        return transport;
      },
    });
    expect((await speechError(client.synthesize({ text: "Timeout", voicePath }))).code).toBe(
      "timeout",
    );

    let settled = false;
    const shutdown = client.shutdown().then((): void => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    transport.emitExit(null, "SIGKILL");
    await shutdown;
    expect(settled).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("waits for killed process exit before surfacing a close failure", async () => {
  const { directory, voicePath, workerPath } = fixture();
  const transport = new FakeTransport();
  transport.closeFailure = new Error("stdin closed");
  transport.exitOnKill = false;
  try {
    transport.onWrite = (request): void => {
      if (request.type === "synthesize") {
        transport.emitLine({
          type: "synthesize",
          id: request.id,
          output_path: request.output_path,
          sample_rate: 24000,
        });
      } else {
        transport.emitLine({ type: "shutdown", id: request.id });
      }
    };
    const ids = ["close-speech", "close-shutdown"];
    const client = new ChatterboxWorkerClient({
      dataDirectory: directory,
      gpuUuid: GPU_UUID,
      workerPath,
      randomId: (): string => ids.shift() ?? "unused",
      shutdownKillTimeoutMs: 1_000,
      spawnWorker: (): SpeechWorkerTransport => {
        queueMicrotask(() => transport.emitLine(readyFrame));
        return transport;
      },
    });
    await client.synthesize({ text: "Close safely", voicePath });

    let settled = false;
    const shutdown = client.shutdown().then(
      (): SpeechWorkerError => {
        settled = true;
        throw new Error("Expected shutdown to fail");
      },
      (error: unknown): SpeechWorkerError => {
        settled = true;
        if (error instanceof SpeechWorkerError) return error;
        throw error;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(transport.killed).toBe(true);

    transport.emitExit(null, "SIGKILL");
    expect((await shutdown).message).toContain("stdin closed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("kills a worker that emits a malformed JSONL frame", async () => {
  const { directory, voicePath, workerPath } = fixture();
  const transport = new FakeTransport();
  try {
    transport.onWrite = (request): void => {
      if (request.type === "synthesize") transport.emitLine("not-json");
    };
    const client = new ChatterboxWorkerClient({
      dataDirectory: directory,
      gpuUuid: GPU_UUID,
      workerPath,
      randomId: (): string => "speech-invalid",
      spawnWorker: (): SpeechWorkerTransport => {
        queueMicrotask(() => transport.emitLine(readyFrame));
        return transport;
      },
    });

    const error = await speechError(client.synthesize({ text: "Invalid frame", voicePath }));
    expect(error.code).toBe("protocol");
    expect(transport.killed).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("holds the permit until an interrupted worker confirms exit", async () => {
  const { directory, voicePath, workerPath } = fixture();
  const transport = new FakeTransport();
  transport.exitOnKill = false;
  try {
    const client = new ChatterboxWorkerClient({
      dataDirectory: directory,
      gpuUuid: GPU_UUID,
      workerPath,
      randomId: (): string => "speech-interrupted",
      spawnWorker: (): SpeechWorkerTransport => {
        queueMicrotask(() => transport.emitLine(readyFrame));
        return transport;
      },
    });
    const fiber = Effect.runFork(client.synthesizeEffect({ text: "Interrupt me", voicePath }));
    while (transport.writes.length === 0) await Promise.resolve();

    let settled = false;
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber)).then((): void => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(transport.killed).toBe(true);
    expect(settled).toBe(false);

    transport.emitExit(null, "SIGKILL");
    await interrupted;
    expect(settled).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("terminates an active synthesis without waiting for its permit", async () => {
  const { directory, voicePath, workerPath } = fixture();
  const transport = new FakeTransport();
  transport.exitOnKill = false;
  try {
    const client = new ChatterboxWorkerClient({
      dataDirectory: directory,
      gpuUuid: GPU_UUID,
      workerPath,
      randomId: (): string => "terminate-active",
      spawnWorker: (): SpeechWorkerTransport => {
        queueMicrotask(() => transport.emitLine(readyFrame));
        return transport;
      },
    });
    const synthesis = client.synthesize({ text: "Stop now", voicePath });
    await Promise.resolve();
    await Promise.resolve();

    let terminated = false;
    const termination = client.terminate().then((): void => {
      terminated = true;
    });
    await expect(synthesis).rejects.toThrow("interrupted");
    expect(transport.killed).toBe(true);
    expect(terminated).toBe(false);

    transport.emitExit(null, "SIGKILL");
    await termination;
    expect(terminated).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("kills a real worker transport before an oversized frame can accumulate", async () => {
  const transport = spawnNodeSpeechWorker({
    command: process.execPath,
    args: [
      "-e",
      'process.stderr.write(("x".repeat(1024)+"\\n").repeat(100));process.stdout.write("x".repeat(70000)+"\\n");setInterval(()=>{},1000)',
    ],
    env: process.env,
  });
  const stderr: string[] = [];
  let protocolError = "";
  const exited = new Promise<void>((resolve) => {
    transport.onStderr((line) => stderr.push(line));
    transport.onError((error) => {
      protocolError = error.message;
    });
    transport.onExit(() => resolve());
  });

  await exited;
  expect(protocolError).toContain("oversized frame");
  expect(stderr.filter((line) => line === "Speech worker stderr truncated")).toHaveLength(1);
  expect(Buffer.byteLength(stderr.join(""), "utf8")).toBeLessThanOrEqual(65 * 1024);
});
