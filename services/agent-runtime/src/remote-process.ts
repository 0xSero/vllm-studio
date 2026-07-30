import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type ProcessRequest = {
  file: string;
  args: readonly string[];
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Readonly<Record<string, string>>;
};

export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunningProcess = {
  process: ChildProcessWithoutNullStreams;
  completion: Promise<ProcessResult>;
  stop(): Promise<ProcessResult>;
};

export class RemoteProcessError extends Error {
  constructor(
    message: string,
    readonly result?: ProcessResult,
  ) {
    super(message);
  }
}

const appendBounded = (
  chunks: Buffer[],
  chunk: Buffer,
  state: { size: number },
  limit: number,
  child: ChildProcessWithoutNullStreams,
): void => {
  state.size += chunk.byteLength;
  if (state.size > limit) {
    child.kill("SIGKILL");
    throw new RemoteProcessError("Process output exceeded the safety limit");
  }
  chunks.push(chunk);
};

export const startProcess = (request: ProcessRequest): RunningProcess => {
  const timeoutMs = request.timeoutMs ?? 15_000;
  const maxOutputBytes = request.maxOutputBytes ?? 1_048_576;
  const child = spawn(request.file, [...request.args], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: request.env ? { ...process.env, ...request.env } : process.env,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const output = { size: 0 };
  let outputError: Error | undefined;
  const capture = (target: Buffer[]) => (chunk: Buffer) => {
    try {
      appendBounded(target, chunk, output, maxOutputBytes, child);
    } catch (error) {
      outputError = error instanceof Error ? error : new Error(String(error));
    }
  };
  child.stdout.on("data", capture(stdout));
  child.stderr.on("data", capture(stderr));
  if (request.stdin === undefined) child.stdin.end();
  else child.stdin.end(request.stdin);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref();
  const completion = new Promise<ProcessResult>((resolve, reject) => {
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      const result = {
        exitCode: exitCode ?? 128,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (outputError) reject(outputError);
      else if (timedOut) reject(new RemoteProcessError("Process timed out", result));
      else resolve(result);
    });
  });
  return {
    process: child,
    completion,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      return completion;
    },
  };
};

export const runProcess = async (request: ProcessRequest): Promise<ProcessResult> => {
  const result = await startProcess(request).completion;
  if (result.exitCode !== 0) {
    throw new RemoteProcessError(`Process exited with status ${result.exitCode}`, result);
  }
  return result;
};
