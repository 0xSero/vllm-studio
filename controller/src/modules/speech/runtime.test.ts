import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CHATTERBOX_MODEL_REVISION } from "@local-studio/contracts/speech";
import {
  CHATTERBOX_PACKAGE_SPEC,
  ChatterboxRuntime,
  type SpeechRuntimeCommand,
  type SpeechRuntimeCommandOptions,
} from "./runtime";

const GPU_UUID = "GPU-01234567-89ab-cdef-0123-456789abcdef";

type CommandCall = {
  readonly command: string;
  readonly args: string[];
  readonly options: SpeechRuntimeCommandOptions;
};

const successfulCommands =
  (calls: CommandCall[]): SpeechRuntimeCommand =>
  (command, args, options) => {
    calls.push({ command, args, options });
    return Effect.succeed({ status: 0, stdout: "", stderr: "", timedOut: false });
  };

test("installs Chatterbox asynchronously with uv and a pinned CUDA target", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-runtime-"));
  const workerPath = join(directory, "worker.py");
  const calls: CommandCall[] = [];
  writeFileSync(workerPath, "");
  try {
    const runtime = new ChatterboxRuntime({
      dataDirectory: directory,
      workerPath,
      resolveBinary: (name): string | null => (name === "uv" ? "/opt/uv" : null),
      runCommand: successfulCommands(calls),
      now: (): Date => new Date("2026-07-09T12:00:00.000Z"),
      environment: {
        PATH: "/usr/bin",
        HOME: "/home/local-studio",
        LOCAL_STUDIO_API_KEY: "controller-secret",
        HF_TOKEN: "hub-secret",
      },
    });

    expect(runtime.startInstall(GPU_UUID)).toEqual({
      status: "installing",
      stage: "preparing",
      progress: 0.05,
      gpuUuid: GPU_UUID,
    });
    expect(await runtime.waitForInstall()).toEqual({
      status: "installed",
      packageVersion: "0.1.7",
      modelRevision: CHATTERBOX_MODEL_REVISION,
      gpuUuid: GPU_UUID,
      installedAt: "2026-07-09T12:00:00.000Z",
    });

    expect(calls.map(({ command, args }) => [command, args])).toEqual([
      ["/opt/uv", ["venv", "--python", "3.11", runtime.paths.runtimeDirectory]],
      [
        "/opt/uv",
        [
          "pip",
          "install",
          "--python",
          runtime.paths.pythonPath,
          "--torch-backend=cu124",
          "--upgrade",
          CHATTERBOX_PACKAGE_SPEC,
        ],
      ],
      [runtime.paths.pythonPath, [workerPath, "--prefetch"]],
    ]);
    const prefetchEnvironment = calls[2]?.options.env;
    expect(prefetchEnvironment?.["CUDA_VISIBLE_DEVICES"]).toBe(GPU_UUID);
    expect(prefetchEnvironment?.["CUDA_DEVICE_ORDER"]).toBe("PCI_BUS_ID");
    expect(prefetchEnvironment?.["HF_HOME"]).toBe(runtime.paths.cacheDirectory);
    expect(prefetchEnvironment?.["LOCAL_STUDIO_SPEECH_VOICES_DIR"]).toBeUndefined();
    expect(prefetchEnvironment?.["LOCAL_STUDIO_SPEECH_OUTPUTS_DIR"]).toBeUndefined();
    expect(calls.every(({ options }) => options.env?.["CUDA_VISIBLE_DEVICES"] === GPU_UUID)).toBe(
      true,
    );
    expect(calls.every(({ options }) => options.env?.["LOCAL_STUDIO_API_KEY"] === undefined)).toBe(
      true,
    );
    expect(calls.every(({ options }) => options.env?.["HF_TOKEN"] === undefined)).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("uses the pinned CUDA 12.4 PyTorch wheels before pip fallback install", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-runtime-pip-"));
  const workerPath = join(directory, "worker.py");
  const calls: CommandCall[] = [];
  writeFileSync(workerPath, "");
  try {
    const runtime = new ChatterboxRuntime({
      dataDirectory: directory,
      workerPath,
      resolveBinary: (name): string | null => (name === "python3.11" ? "/opt/python3.11" : null),
      runCommand: successfulCommands(calls),
    });

    expect((await runtime.install(GPU_UUID)).status).toBe("installed");
    expect(calls.map(({ command, args }) => [command, args])).toEqual([
      ["/opt/python3.11", ["-m", "venv", runtime.paths.runtimeDirectory]],
      [runtime.paths.pythonPath, ["-m", "pip", "--version"]],
      [
        runtime.paths.pythonPath,
        [
          "-m",
          "pip",
          "install",
          "--upgrade",
          "torch==2.6.0+cu124",
          "torchaudio==2.6.0+cu124",
          "--index-url",
          "https://download.pytorch.org/whl/cu124",
        ],
      ],
      [runtime.paths.pythonPath, ["-m", "pip", "install", "--upgrade", CHATTERBOX_PACKAGE_SPEC]],
      [runtime.paths.pythonPath, [workerPath, "--prefetch"]],
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a GPU index before starting install work", async () => {
  const runtime = new ChatterboxRuntime({
    dataDirectory: "/tmp/local-studio-invalid-gpu",
    resolveBinary: (): null => null,
  });

  expect(await runtime.install("0")).toEqual({
    status: "error",
    gpuUuid: "0",
    message: "A full NVIDIA GPU UUID is required",
  });
});

test("cancels an active install before reporting completion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-runtime-cancel-"));
  const workerPath = join(directory, "worker.py");
  let started: (() => void) | null = null;
  const commandStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  writeFileSync(workerPath, "");
  try {
    const runtime = new ChatterboxRuntime({
      dataDirectory: directory,
      workerPath,
      resolveBinary: (name): string | null => (name === "uv" ? "/opt/uv" : null),
      runCommand: (_command, _args, options): ReturnType<SpeechRuntimeCommand> =>
        Effect.callback((resume) => {
          const abort = (): void => {
            resume(
              Effect.succeed({
                status: null,
                stdout: "",
                stderr: "cancelled",
                timedOut: false,
              }),
            );
          };
          started?.();
          options.signal?.addEventListener("abort", abort, { once: true });
          return Effect.sync(() => options.signal?.removeEventListener("abort", abort));
        }),
    });

    expect(runtime.startInstall(GPU_UUID).status).toBe("installing");
    await commandStarted;
    await runtime.cancelInstall();
    expect(await runtime.waitForInstall()).toEqual({
      status: "error",
      gpuUuid: GPU_UUID,
      message: "Chatterbox install cancelled",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("repairs an installed runtime only when explicitly requested", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-runtime-repair-"));
  const workerPath = join(directory, "worker.py");
  const calls: CommandCall[] = [];
  writeFileSync(workerPath, "");
  try {
    const runtime = new ChatterboxRuntime({
      dataDirectory: directory,
      workerPath,
      resolveBinary: (name): string | null => (name === "uv" ? "/opt/uv" : null),
      runCommand: successfulCommands(calls),
    });
    await runtime.install(GPU_UUID);
    const installedCalls = calls.length;
    expect(runtime.startInstall(GPU_UUID).status).toBe("installed");
    expect(calls).toHaveLength(installedCalls);

    expect(runtime.startInstall(GPU_UUID, { repair: true }).status).toBe("installing");
    expect((await runtime.waitForInstall()).status).toBe("installed");
    expect(calls.length).toBeGreaterThan(installedCalls);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("secures speech storage and removes only owned orphan plaintext", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-speech-storage-"));
  const speech = join(directory, "runtime", "speech");
  const uploads = join(speech, "uploads");
  const outputs = join(speech, "outputs");
  const orphan = "123e4567-e89b-42d3-a456-426614174000.wav";
  try {
    mkdirSync(uploads, { recursive: true, mode: 0o755 });
    mkdirSync(outputs, { recursive: true, mode: 0o755 });
    writeFileSync(join(uploads, orphan), "plain", { mode: 0o644 });
    writeFileSync(join(outputs, orphan), "plain", { mode: 0o644 });
    writeFileSync(join(outputs, "preserve.wav"), "unowned", { mode: 0o644 });

    const runtime = new ChatterboxRuntime({ dataDirectory: directory });

    expect(readdirSync(uploads)).toEqual([]);
    expect(readdirSync(outputs)).toEqual(["preserve.wav"]);
    expect(statSync(runtime.paths.speechDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(runtime.paths.cacheDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(runtime.paths.voiceDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(runtime.paths.outputDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(runtime.paths.uploadDirectory).mode & 0o777).toBe(0o700);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("binds the Python worker lifetime before loading CUDA", () => {
  const source = readFileSync(new URL("worker.py", import.meta.url), "utf8");
  const main = source.slice(source.indexOf("def main():"));

  expect(source).toContain("libc.prctl(1, signal.SIGKILL, 0, 0, 0)");
  expect(source).toContain("if os.getppid() != parent_pid:");
  expect(source).toContain("threading.Thread(target=watch_parent, daemon=True).start()");
  expect(source).toContain("os.umask(0o077)");
  expect(source).toContain("output_path.chmod(0o600)");
  expect(main.indexOf("bind_parent_lifetime()")).toBeLessThan(main.indexOf("prefetch()"));
  expect(main.indexOf("bind_parent_lifetime()")).toBeLessThan(main.indexOf("serve()"));
});
