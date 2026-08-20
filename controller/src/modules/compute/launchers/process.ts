import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { Effect } from "effect";
import type { HandleReference, InstanceRecord, LaunchPlan } from "../contracts";
import { LOG_TAIL_BYTES, spawnFailed, type Launcher } from "./launcher";

const STOP_POLL_MS = 250;
const LAUNCH_MARKER = "LOCAL_STUDIO_LAUNCH_NONCE";

export interface ProcessIdentity {
  readonly pid: number;
  readonly processGroupId: number;
  readonly sessionId: number;
  readonly startToken: string;
  readonly launchMarker: string | null;
  readonly parentProcessId?: number;
}

export interface ProcessLauncherRuntime {
  readonly platform: NodeJS.Platform;
  readonly readIdentity: (pid: number) => ProcessIdentity | null;
  readonly readGroup: (processGroupId: number) => readonly ProcessIdentity[] | null;
  readonly signalGroup: (processGroupId: number, signal: NodeJS.Signals) => void;
}

const parsePsIdentity = (line: string): ProcessIdentity | null => {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  const processGroupId = Number(match[2]);
  const sessionId = Number(match[3]);
  const startToken = match[4]?.trim() ?? "";
  if (![pid, processGroupId, sessionId].every(Number.isSafeInteger) || !startToken) return null;
  return { pid, processGroupId, sessionId, startToken, launchMarker: null };
};

const readLinuxIdentity = (pid: number): ProcessIdentity | null => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const processGroupId = Number(afterComm[2]);
    const sessionId = Number(afterComm[3]);
    const startToken = afterComm[19] ?? "";
    if (![pid, processGroupId, sessionId].every(Number.isSafeInteger) || !startToken) return null;
    const prefix = `${LAUNCH_MARKER}=`;
    let launchMarker: string | null = null;
    try {
      launchMarker =
        readFileSync(`/proc/${pid}/environ`, "utf8")
          .split("\0")
          .find((entry) => entry.startsWith(prefix))
          ?.slice(prefix.length) ?? null;
    } catch {}
    return { pid, processGroupId, sessionId, startToken, launchMarker };
  } catch {
    return null;
  }
};

const readLinuxGroup = (processGroupId: number): readonly ProcessIdentity[] | null => {
  try {
    return readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry))
      .map((entry) => readLinuxIdentity(Number(entry)))
      .filter(
        (identity): identity is ProcessIdentity =>
          identity !== null && identity.processGroupId === processGroupId,
      );
  } catch {
    return null;
  }
};

const readPosixIdentity = (pid: number): ProcessIdentity | null => {
  try {
    const result = spawnSync(
      "ps",
      ["-o", "pid=,pgid=,sid=,lstart=", "-p", String(pid)],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return null;
    return parsePsIdentity(result.stdout.toString());
  } catch {
    return null;
  }
};

const readPosixGroup = (processGroupId: number): readonly ProcessIdentity[] | null => {
  try {
    const result = spawnSync(
      "ps",
      ["-axo", "pid=,pgid=,sid=,lstart="],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return null;
    return result.stdout
      .toString()
      .split(/\r?\n/)
      .map((line) => parsePsIdentity(line))
      .filter(
        (identity): identity is ProcessIdentity =>
          identity !== null && identity.processGroupId === processGroupId,
      );
  } catch {
    return null;
  }
};

interface WindowsProcessEntry {
  readonly pid: number;
  readonly parentProcessId: number;
  readonly startToken: string;
}

const readWindowsEntries = (): readonly WindowsProcessEntry[] | null => {
  try {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return null;
    const output = result.stdout.toString().trim();
    if (!output) return [];
    const parsed: unknown = JSON.parse(output);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row) => {
      if (typeof row !== "object" || row === null) return [];
      const value = row as Record<string, unknown>;
      const pid = Number(value["ProcessId"]);
      const parentProcessId = Number(value["ParentProcessId"]);
      const startToken = String(value["CreationDate"] ?? "");
      return Number.isSafeInteger(pid) &&
        Number.isSafeInteger(parentProcessId) &&
        startToken
        ? [{ pid, parentProcessId, startToken }]
        : [];
    });
  } catch {
    return null;
  }
};

const readWindowsIdentity = (pid: number): ProcessIdentity | null => {
  const entries = readWindowsEntries();
  const entry = entries?.find((candidate) => candidate.pid === pid);
  return entry
    ? {
        pid,
        processGroupId: pid,
        sessionId: pid,
        startToken: entry.startToken,
        launchMarker: null,
        parentProcessId: entry.parentProcessId,
      }
    : null;
};

const readWindowsGroup = (processGroupId: number): readonly ProcessIdentity[] | null => {
  const entries = readWindowsEntries();
  if (entries === null) return null;
  const root = entries.find((entry) => entry.pid === processGroupId);
  if (!root) {
    return entries.some((entry) => entry.parentProcessId === processGroupId) ? null : [];
  }
  const byParent = new Map<number, WindowsProcessEntry[]>();
  for (const entry of entries) {
    const siblings = byParent.get(entry.parentProcessId) ?? [];
    siblings.push(entry);
    byParent.set(entry.parentProcessId, siblings);
  }
  const members: ProcessIdentity[] = [];
  const pending = [root.pid];
  const seen = new Set<number>();
  while (pending.length > 0) {
    const pid = pending.shift();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    const entry = entries.find((candidate) => candidate.pid === pid);
    if (!entry) return null;
    members.push({
      pid: entry.pid,
      processGroupId,
      sessionId: processGroupId,
      startToken: entry.startToken,
      launchMarker: null,
      parentProcessId: entry.parentProcessId,
    });
    for (const child of byParent.get(pid) ?? []) pending.push(child.pid);
  }
  return members;
};

const signalPosixGroup = (processGroupId: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-processGroupId, signal);
  } catch {}
};

const signalWindowsTree = (processId: number, signal: NodeJS.Signals): void => {
  try {
    spawnSync("taskkill.exe", ["/PID", String(processId), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])]);
  } catch {}
};

const realRuntime: ProcessLauncherRuntime = {
  platform: process.platform,
  readIdentity:
    process.platform === "linux"
      ? readLinuxIdentity
      : process.platform === "win32"
        ? readWindowsIdentity
        : readPosixIdentity,
  readGroup:
    process.platform === "linux"
      ? readLinuxGroup
      : process.platform === "win32"
        ? readWindowsGroup
        : readPosixGroup,
  signalGroup: process.platform === "win32" ? signalWindowsTree : signalPosixGroup,
};

const readTailBytes = (path: string, bytes: number): string => {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const length = size - start;
    if (length <= 0) return "";
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, length, start);
    } finally {
      closeSync(fd);
    }
    return buffer.toString("utf8");
  } catch {
    return "";
  }
};

const sameProcessReference = (reference: HandleReference, record: InstanceRecord): boolean => {
  const stored = record.ref;
  return reference.kind === "process" &&
    stored?.kind === "process" &&
    reference.pid === stored.pid &&
    reference.processGroupId === stored.processGroupId &&
    reference.sessionId === stored.sessionId &&
    reference.startToken === stored.startToken;
};

const childRunning = (child: ChildProcess): boolean =>
  child.exitCode === null && child.signalCode === null;

const ownership = (
  reference: HandleReference,
  record: InstanceRecord,
  runtime: ProcessLauncherRuntime,
  localChildren: ReadonlyMap<number, ChildProcess>,
): "owned" | "gone" | "unknown" => {
  if (reference.kind !== "process" || !sameProcessReference(reference, record)) return "unknown";
  const child = localChildren.get(reference.pid);
  if (child && childRunning(child)) {
    if (reference.startToken === null) return "owned";
    const identity = runtime.readIdentity(reference.pid);
    if (
      identity?.pid === reference.pid &&
      identity.processGroupId === reference.processGroupId &&
      identity.sessionId === reference.sessionId &&
      identity.startToken === reference.startToken
    ) return "owned";
    return "unknown";
  }
  if (
    reference.processGroupId === null ||
    reference.sessionId === null ||
    reference.startToken === null
  ) return "unknown";
  const members = runtime.readGroup(reference.processGroupId);
  if (members === null) return "unknown";
  if (members.length === 0) return "gone";
  const roots = members.filter((member) => member.pid === reference.pid);
  const root = roots[0];
  if (roots.length !== 1 || !root) return "unknown";
  if (
    root.processGroupId !== reference.processGroupId ||
    root.sessionId !== reference.sessionId ||
    root.startToken !== reference.startToken
  ) return "unknown";
  if (new Set(members.map((member) => member.pid)).size !== members.length) return "unknown";
  if (
    members.some(
      (member) =>
        member.processGroupId !== reference.processGroupId ||
        member.sessionId !== reference.sessionId,
    )
  ) return "unknown";
  if (runtime.platform === "linux" && members.some((member) => member.launchMarker !== record.nonce)) {
    return "unknown";
  }
  return "owned";
};

export const makeProcessLauncher = (
  logPathFor: (name: string) => string,
  runtime: ProcessLauncherRuntime = realRuntime,
): Launcher => {
  const localChildren = new Map<number, ChildProcess>();

  return {
    start: (plan: LaunchPlan, record: InstanceRecord) =>
      Effect.gen(function* () {
        const [binary, ...args] = plan.argv;
        if (!binary) return yield* spawnFailed("plan.argv is empty");
        const logFd = yield* Effect.try({
          try: () => openSync(logPathFor(record.name), "w"),
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) =>
            spawnFailed(`cannot open log file for ${record.name}: ${String(error)}`),
          ),
        );
        const child = spawn(binary, args, {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: { ...process.env, ...plan.env, [LAUNCH_MARKER]: record.nonce },
          ...(plan.workdir ? { cwd: plan.workdir } : {}),
        });
        const pid = yield* Effect.callback<number, never>((resume) => {
          child.on("error", () => resume(Effect.succeed(-1)));
          child.on("spawn", () => resume(Effect.succeed(child.pid ?? -1)));
        });
        closeSync(logFd);
        if (pid <= 0) return yield* spawnFailed(`failed to spawn ${binary}`);
        localChildren.set(pid, child);
        child.on("exit", () => {
          if (localChildren.get(pid) === child) localChildren.delete(pid);
        });
        child.unref();
        let observed: ProcessIdentity | null = null;
        let proved: ProcessIdentity | null = null;
        for (let attempt = 0; attempt < 20 && proved === null; attempt += 1) {
          const identity = runtime.readIdentity(pid);
          if (
            identity?.pid === pid &&
            identity.processGroupId === pid &&
            identity.sessionId === pid
          ) {
            observed = identity;
            if (runtime.platform !== "linux" || identity.launchMarker === record.nonce) {
              proved = identity;
            }
          }
          if (!proved) yield* Effect.sleep(25);
        }
        const identity = proved ?? observed;
        const reference = {
          kind: "process",
          pid,
          processGroupId: identity?.processGroupId ?? pid,
          sessionId: identity?.sessionId ?? pid,
          startToken: identity?.startToken ?? null,
        } as const;
        if (!proved) {
          return yield* spawnFailed("spawned process identity could not be proved", reference);
        }
        return reference;
      }),

    alive: (reference, record) =>
      Effect.sync(() =>
        reference.kind === "process" && ownership(reference, record, runtime, localChildren) !== "gone",
      ),

    owns: (reference, record) =>
      Effect.sync(() =>
        reference.kind === "process" && ownership(reference, record, runtime, localChildren) === "owned",
      ),

    stop: (reference, record, graceMs) =>
      Effect.gen(function* () {
        if (reference.kind !== "process" || reference.processGroupId === null) return;
        const processGroupId = reference.processGroupId;
        const term = yield* Effect.sync(() => {
          if (ownership(reference, record, runtime, localChildren) !== "owned") return false;
          runtime.signalGroup(processGroupId, "SIGTERM");
          return true;
        });
        if (!term) return;
        const deadline = Date.now() + graceMs;
        while (Date.now() < deadline) {
          if (ownership(reference, record, runtime, localChildren) !== "owned") return;
          yield* Effect.sleep(STOP_POLL_MS);
        }
        yield* Effect.sync(() => {
          if (ownership(reference, record, runtime, localChildren) === "owned") {
            runtime.signalGroup(processGroupId, "SIGKILL");
          }
        });
      }),

    logTail: (reference: HandleReference, record: InstanceRecord) =>
      Effect.sync(() => readTailBytes(logPathFor(record.name), LOG_TAIL_BYTES)),
  };
};
