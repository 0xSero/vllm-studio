import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { Effect, Schema } from "effect";
import type { Config } from "../../config/env";
import type {
  AsyncCommandOptions,
  AsyncCommandResult,
} from "../../core/command";
import type {
  EngineBackend,
  RuntimeUpgradeResult,
} from "@local-studio/contracts/system";
import { runInWslWithOptions } from "../compute/wsl-platform";
import { ENGINE_INSTALL_TIMEOUT_MS } from "./configs";
import type { InstallProgressUpdate } from "./runtimes/managed-venv";

export type WslManagedBackend = Extract<EngineBackend, "vllm" | "sglang">;

const WslManagedRuntimeReceiptSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  backend: Schema.Literals(["vllm", "sglang"]),
  distribution: Schema.String,
  root: Schema.String,
  pythonPath: Schema.String,
  binaryPath: Schema.String,
  version: Schema.String,
  installedAt: Schema.String,
});

const RuntimeProbeSchema = Schema.Struct({
  version: Schema.String,
  cuda: Schema.Boolean,
  devices: Schema.Number,
});

export type WslManagedRuntimeReceipt = Schema.Schema.Type<
  typeof WslManagedRuntimeReceiptSchema
>;

export interface WslManagedRuntimePaths {
  root: string;
  parent: string;
  pythonPath: string;
  binaryPath: string;
  staging: string;
  backup: string;
}

type WslCommandRunner = (
  distribution: string,
  args: readonly string[],
  options: AsyncCommandOptions,
) => Effect.Effect<AsyncCommandResult>;

interface WslManagedRuntimeOptions {
  config: Config;
  backend: WslManagedBackend;
  distribution: string;
  version?: string | undefined;
  onProgress?: ((update: InstallProgressUpdate) => void) | undefined;
  onSpawn?: ((child: ChildProcess) => void) | undefined;
  runner?: WslCommandRunner | undefined;
}

const PROBE_SCRIPT =
  'import importlib.metadata as m,json,sys,torch; print(json.dumps({"version":m.version(sys.argv[1]),"cuda":torch.cuda.is_available(),"devices":torch.cuda.device_count()}))';
const RELOCATE_SCRIPT =
  "from pathlib import Path; import sys; old,new=sys.argv[1:3]; files=(p for p in (Path(new)/'bin').iterdir() if p.is_file()); [(p.write_text(p.read_text().replace(old,new))) for p in files if old in p.read_text(errors='ignore')]";
const MAX_OUTPUT_TAIL_LENGTH = 4000;
const COMMAND_TIMEOUT_MS = 120_000;
const JOB_OUTPUT_THROTTLE_MS = 1_000;

const tailOutput = (value: string): string =>
  value.length > MAX_OUTPUT_TAIL_LENGTH ? value.slice(-MAX_OUTPUT_TAIL_LENGTH) : value;

const receiptDirectory = (config: Pick<Config, "data_dir">, distribution: string): string =>
  join(config.data_dir, "runtime", "wsl2", Buffer.from(distribution).toString("base64url"));

export const wslManagedRuntimeReceiptPath = (
  config: Pick<Config, "data_dir">,
  distribution: string,
  backend: WslManagedBackend,
): string => join(receiptDirectory(config, distribution), `${backend}.json`);

export const readWslManagedRuntimeReceipt = (
  config: Pick<Config, "data_dir">,
  distribution: string,
  backend: WslManagedBackend,
): WslManagedRuntimeReceipt | null => {
  const path = wslManagedRuntimeReceiptPath(config, distribution, backend);
  if (!existsSync(path)) return null;
  try {
    const receipt = Schema.decodeUnknownSync(WslManagedRuntimeReceiptSchema)(
      JSON.parse(readFileSync(path, "utf8")) as unknown,
    );
    return receipt.backend === backend && receipt.distribution === distribution ? receipt : null;
  } catch {
    return null;
  }
};

const writeReceipt = (
  config: Pick<Config, "data_dir">,
  receipt: WslManagedRuntimeReceipt,
): void => {
  const path = wslManagedRuntimeReceiptPath(config, receipt.distribution, receipt.backend);
  const temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
};

const removeReceipt = (
  config: Pick<Config, "data_dir">,
  distribution: string,
  backend: WslManagedBackend,
): void => {
  rmSync(wslManagedRuntimeReceiptPath(config, distribution, backend), { force: true });
};

const normalizedHome = (home: string): string => {
  const normalized = posix.normalize(home.trim());
  if (!posix.isAbsolute(normalized) || normalized === "/") {
    throw new Error(`Unsafe WSL home directory: ${home}`);
  }
  return normalized;
};

export const wslManagedRuntimePaths = (
  home: string,
  backend: WslManagedBackend,
  nonce = "operation",
): WslManagedRuntimePaths => {
  const parent = posix.join(
    normalizedHome(home),
    ".local",
    "share",
    "local-studio",
    "runtime",
    "venvs",
  );
  const root = posix.join(parent, `${backend}-latest`);
  return {
    root,
    parent,
    pythonPath: posix.join(root, "bin", "python"),
    binaryPath: posix.join(root, "bin", backend),
    staging: posix.join(parent, `.${backend}-install-${nonce}`),
    backup: posix.join(parent, `.${backend}-backup-${nonce}`),
  };
};

export const wslManagedPackageSpec = (
  backend: WslManagedBackend,
  version?: string,
): string | null => {
  const normalized = version?.trim();
  if (!normalized) return backend;
  return /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(normalized)
    ? `${backend}==${normalized}`
    : null;
};

export const wslManagedInstallArguments = (
  installer: "uv" | "pip",
  installerPath: string,
  pythonPath: string,
  packageSpec: string,
): readonly [string, readonly string[]] =>
  installer === "uv"
    ? [
        installerPath,
        ["pip", "install", "--python", pythonPath, "--upgrade", packageSpec, "--torch-backend=auto"],
      ]
    : [pythonPath, ["-m", "pip", "install", "--upgrade", packageSpec]];

const commandFailure = (
  message: string,
  result?: AsyncCommandResult,
  usedCommand?: string,
): RuntimeUpgradeResult => ({
  success: false,
  version: null,
  output: result?.stdout || null,
  error: result?.timedOut ? `${message} timed out` : result?.stderr || message,
  used_command: usedCommand ?? null,
});

const successResult = (
  version: string | null,
  output: string,
  usedCommand: string,
): RuntimeUpgradeResult => ({
  success: true,
  version,
  output: output || null,
  error: null,
  used_command: usedCommand,
});

const run = (
  runner: WslCommandRunner,
  distribution: string,
  args: readonly string[],
  timeoutMs: number,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
  onOutput?: (chunk: string) => void,
): Effect.Effect<AsyncCommandResult> =>
  runner(distribution, args, {
    timeoutMs,
    ...(options.onSpawn ? { onSpawn: options.onSpawn } : {}),
    ...(onOutput ? { onOutput } : {}),
  });

const resolveCommand = (
  runner: WslCommandRunner,
  distribution: string,
  command: string,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<string | null> =>
  run(
    runner,
    distribution,
    ["/bin/sh", "-lc", 'command -v -- "$1"', "local-studio", command],
    COMMAND_TIMEOUT_MS,
    options,
  ).pipe(
    Effect.map((result) =>
      result.status === 0 && result.stdout.trim()
        ? (result.stdout.trim().split(/\r?\n/).at(-1) ?? null)
        : null,
    ),
  );

const resolveHome = (
  runner: WslCommandRunner,
  distribution: string,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const uid = yield* run(
      runner,
      distribution,
      ["/usr/bin/id", "-u"],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (uid.status !== 0 || !/^\d+$/.test(uid.stdout.trim())) {
      return yield* Effect.fail(new Error(uid.stderr || "Could not resolve the WSL user id"));
    }
    const passwd = yield* run(
      runner,
      distribution,
      ["/usr/bin/getent", "passwd", uid.stdout.trim()],
      COMMAND_TIMEOUT_MS,
      options,
    );
    const home = passwd.stdout.trim().split(":")[5] ?? "";
    if (passwd.status !== 0 || !home) {
      return yield* Effect.fail(new Error(passwd.stderr || "Could not resolve the WSL home directory"));
    }
    return normalizedHome(home);
  });

const cleanupPath = (
  runner: WslCommandRunner,
  distribution: string,
  path: string,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<void> =>
  run(
    runner,
    distribution,
    ["/bin/rm", "-rf", "--", path],
    COMMAND_TIMEOUT_MS,
    options,
  ).pipe(Effect.asVoid, Effect.catch(() => Effect.void));

const activate = (
  runner: WslCommandRunner,
  distribution: string,
  paths: WslManagedRuntimePaths,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<RuntimeUpgradeResult | { hadBackup: boolean }> =>
  Effect.gen(function* () {
    const existing = yield* run(
      runner,
      distribution,
      ["/usr/bin/test", "-e", paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    const hadBackup = existing.status === 0;
    if (hadBackup) {
      const backup = yield* run(
        runner,
        distribution,
        ["/bin/mv", "--", paths.root, paths.backup],
        COMMAND_TIMEOUT_MS,
        options,
      );
      if (backup.status !== 0) return commandFailure("Could not stage the previous WSL runtime", backup);
    }
    const promote = yield* run(
      runner,
      distribution,
      ["/bin/mv", "--", paths.staging, paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (promote.status !== 0) {
      const backupExists = yield* run(
        runner,
        distribution,
        ["/usr/bin/test", "-e", paths.backup],
        COMMAND_TIMEOUT_MS,
        options,
      );
      if (backupExists.status === 0) {
        yield* run(
          runner,
          distribution,
          ["/bin/mv", "--", paths.backup, paths.root],
          COMMAND_TIMEOUT_MS,
          options,
        );
      }
      return commandFailure("Could not activate the WSL runtime", promote);
    }
    return { hadBackup };
  });

const rollbackActivation = (
  runner: WslCommandRunner,
  distribution: string,
  paths: WslManagedRuntimePaths,
  hadBackup: boolean,
  options: Pick<WslManagedRuntimeOptions, "onSpawn">,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* cleanupPath(runner, distribution, paths.root, options);
    if (hadBackup) {
      yield* run(
        runner,
        distribution,
        ["/bin/mv", "--", paths.backup, paths.root],
        COMMAND_TIMEOUT_MS,
        options,
      ).pipe(Effect.ignore);
    }
  });

export const installWslManagedRuntime = (
  options: WslManagedRuntimeOptions,
): Effect.Effect<RuntimeUpgradeResult> =>
  Effect.gen(function* () {
    if (process.platform !== "win32" && !options.runner) {
      return commandFailure("Managed WSL2 installation is available only on Windows");
    }
    const packageSpec = wslManagedPackageSpec(options.backend, options.version);
    if (!packageSpec) return commandFailure(`Invalid ${options.backend} version`);
    const runner = options.runner ?? runInWslWithOptions;
    const home = yield* resolveHome(runner, options.distribution, options).pipe(
      Effect.catch((error) => Effect.succeed(error)),
    );
    if (home instanceof Error) return commandFailure(home.message);
    const paths = wslManagedRuntimePaths(home, options.backend, randomUUID());
    const python = yield* resolveCommand(runner, options.distribution, "python3", options);
    if (!python) return commandFailure(`Python 3 was not found in ${options.distribution}`);
    const uv = yield* resolveCommand(runner, options.distribution, "uv", options);
    options.onProgress?.({ progress: 0.05, message: `Creating ${options.backend} in ${options.distribution}...` });
    const parent = yield* run(
      runner,
      options.distribution,
      ["/bin/mkdir", "-p", "--", paths.parent],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (parent.status !== 0) return commandFailure("Could not create the WSL runtime directory", parent);
    const createCommand = uv ?? python;
    const createArguments = uv
      ? ["venv", "--python", python, "--seed", "--relocatable", paths.staging]
      : ["-m", "venv", paths.staging];
    const create = yield* run(
      runner,
      options.distribution,
      [createCommand, ...createArguments],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (create.status !== 0) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure("Could not create the managed WSL virtual environment", create);
    }
    const stagingPython = posix.join(paths.staging, "bin", "python");
    const stagingBinary = posix.join(paths.staging, "bin", options.backend);
    const [installerCommand, installerArguments] = wslManagedInstallArguments(
      uv ? "uv" : "pip",
      uv ?? stagingPython,
      stagingPython,
      packageSpec,
    );
    const usedCommand = [installerCommand, ...installerArguments].join(" ");
    let output = "";
    let progress = 0.1;
    let lastUpdateAt = 0;
    options.onProgress?.({ progress, message: `Installing ${packageSpec} in ${options.distribution}...` });
    const install = yield* run(
      runner,
      options.distribution,
      [installerCommand, ...installerArguments],
      ENGINE_INSTALL_TIMEOUT_MS,
      options,
      (chunk) => {
        output = tailOutput(output + chunk);
        const now = Date.now();
        if (now - lastUpdateAt < JOB_OUTPUT_THROTTLE_MS) return;
        lastUpdateAt = now;
        progress = Math.min(0.85, progress + 0.01);
        options.onProgress?.({
          progress,
          message: `Installing ${packageSpec} in ${options.distribution}...`,
          outputTail: output,
        });
      },
    );
    if (install.status !== 0) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure(`Install of ${packageSpec} failed`, install, usedCommand);
    }
    options.onProgress?.({ progress: 0.9, message: `Validating ${options.backend} and CUDA...` });
    const probe = yield* run(
      runner,
      options.distribution,
      [stagingPython, "-c", PROBE_SCRIPT, options.backend],
      COMMAND_TIMEOUT_MS,
      options,
    );
    let probeData: Schema.Schema.Type<typeof RuntimeProbeSchema> | null = null;
    try {
      probeData =
        probe.status === 0
          ? Schema.decodeUnknownSync(RuntimeProbeSchema)(JSON.parse(probe.stdout) as unknown)
          : null;
    } catch {
      probeData = null;
    }
    if (!probeData || !probeData.cuda || probeData.devices < 1) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure(
        probeData
          ? `${options.backend} installed but CUDA is unavailable in ${options.distribution}`
          : `${options.backend} import/version probe failed in ${options.distribution}`,
        probe,
        usedCommand,
      );
    }
    const cli = yield* run(
      runner,
      options.distribution,
      [stagingBinary, "--help"],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (cli.status !== 0) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return commandFailure(`${options.backend} CLI probe failed in ${options.distribution}`, cli, usedCommand);
    }
    const activation = yield* activate(runner, options.distribution, paths, options);
    if ("success" in activation) {
      yield* cleanupPath(runner, options.distribution, paths.staging, options);
      return activation;
    }
    const relocate = yield* run(
      runner,
      options.distribution,
      [paths.pythonPath, "-c", RELOCATE_SCRIPT, paths.staging, paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (relocate.status !== 0) {
      yield* rollbackActivation(
        runner,
        options.distribution,
        paths,
        activation.hadBackup,
        options,
      );
      return commandFailure(`${options.backend} relocation failed in ${options.distribution}`, relocate, usedCommand);
    }
    const activatedCli = yield* run(
      runner,
      options.distribution,
      [paths.binaryPath, "--help"],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (activatedCli.status !== 0) {
      yield* rollbackActivation(
        runner,
        options.distribution,
        paths,
        activation.hadBackup,
        options,
      );
      return commandFailure(
        `${options.backend} activated CLI probe failed in ${options.distribution}`,
        activatedCli,
        usedCommand,
      );
    }
    yield* cleanupPath(runner, options.distribution, paths.backup, options);
    yield* Effect.try({
      try: () =>
        writeReceipt(options.config, {
          schemaVersion: 1,
          backend: options.backend,
          distribution: options.distribution,
          root: paths.root,
          pythonPath: paths.pythonPath,
          binaryPath: paths.binaryPath,
          version: probeData.version,
          installedAt: new Date().toISOString(),
        }),
      catch: (error) => new Error(`Could not persist the managed WSL runtime: ${String(error)}`),
    });
    options.onProgress?.({ progress: 1, message: `${options.backend} ${probeData.version} is ready in ${options.distribution}` });
    return successResult(probeData.version, output || install.stdout, usedCommand);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(commandFailure(error instanceof Error ? error.message : String(error))),
    ),
  );

export const uninstallWslManagedRuntime = (
  options: Omit<WslManagedRuntimeOptions, "version">,
): Effect.Effect<RuntimeUpgradeResult> =>
  Effect.gen(function* () {
    if (process.platform !== "win32" && !options.runner) {
      return commandFailure("Managed WSL2 removal is available only on Windows");
    }
    const receipt = readWslManagedRuntimeReceipt(
      options.config,
      options.distribution,
      options.backend,
    );
    if (!receipt) return successResult(null, "Managed WSL runtime is already absent", "no-op");
    const runner = options.runner ?? runInWslWithOptions;
    const home = yield* resolveHome(runner, options.distribution, options).pipe(
      Effect.catch((error) => Effect.succeed(error)),
    );
    if (home instanceof Error) return commandFailure(home.message);
    const paths = wslManagedRuntimePaths(home, options.backend);
    if (
      receipt.root !== paths.root ||
      receipt.pythonPath !== paths.pythonPath ||
      receipt.binaryPath !== paths.binaryPath
    ) {
      return commandFailure("Managed WSL runtime receipt does not match the safe runtime path");
    }
    options.onProgress?.({ progress: 0.2, message: `Removing ${options.backend} from ${options.distribution}...` });
    const remove = yield* run(
      runner,
      options.distribution,
      ["/bin/rm", "-rf", "--", paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (remove.status !== 0) return commandFailure("Could not remove the managed WSL runtime", remove);
    const verify = yield* run(
      runner,
      options.distribution,
      ["/usr/bin/test", "!", "-e", paths.root],
      COMMAND_TIMEOUT_MS,
      options,
    );
    if (verify.status !== 0) return commandFailure("Managed WSL runtime still exists after removal", verify);
    yield* Effect.try({
      try: () => removeReceipt(options.config, options.distribution, options.backend),
      catch: (error) => new Error(`Could not remove the managed WSL receipt: ${String(error)}`),
    });
    options.onProgress?.({ progress: 1, message: `${options.backend} was removed from ${options.distribution}` });
    return successResult(null, `Removed ${paths.root}`, `/bin/rm -rf -- ${paths.root}`);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(commandFailure(error instanceof Error ? error.message : String(error))),
    ),
  );
