import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { Effect } from "effect";
import type { HandleReference, InstanceRecord, LaunchPlan } from "../contracts";
import { redactLogText } from "../../../core/log-redaction";
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
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  const parentProcessId = Number(match[2]);
  const processGroupId = Number(match[3]);
  const sessionId = Number(match[4]);
  const startToken = match[5]?.trim() ?? "";
  if (
    ![pid, parentProcessId, processGroupId, sessionId].every(Number.isSafeInteger) ||
    !startToken
  ) return null;
  return { pid, parentProcessId, processGroupId, sessionId, startToken, launchMarker: null };
};

const readPosixLaunchMarker = (pid: number): string | null => {
  try {
    const result = spawnSync(
      "ps",
      ["eww", "-p", String(pid), "-o", "command="],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return null;
    const match = result.stdout.toString().match(new RegExp(`(?:^|\\s)${LAUNCH_MARKER}=([^\\s]+)`));
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

const readLinuxIdentity = (pid: number): ProcessIdentity | null => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (afterComm[0] === "Z") return null;
    const parentProcessId = Number(afterComm[1]);
    const processGroupId = Number(afterComm[2]);
    const sessionId = Number(afterComm[3]);
    const startToken = afterComm[19] ?? "";
    if (
      ![pid, parentProcessId, processGroupId, sessionId].every(Number.isSafeInteger) ||
      !startToken
    ) return null;
    const prefix = `${LAUNCH_MARKER}=`;
    let launchMarker: string | null = null;
    try {
      launchMarker =
        readFileSync(`/proc/${pid}/environ`, "utf8")
          .split("\0")
          .find((entry) => entry.startsWith(prefix))
          ?.slice(prefix.length) ?? null;
    } catch {}
    return { pid, parentProcessId, processGroupId, sessionId, startToken, launchMarker };
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
      ["-o", "pid=,ppid=,pgid=,sid=,lstart=", "-p", String(pid)],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return null;
    const identity = parsePsIdentity(result.stdout.toString());
    if (!identity) return null;
    return { ...identity, launchMarker: readPosixLaunchMarker(pid) };
  } catch {
    return null;
  }
};

const readPosixGroup = (processGroupId: number): readonly ProcessIdentity[] | null => {
  try {
    const result = spawnSync(
      "ps",
      ["-axo", "pid=,ppid=,pgid=,sid=,lstart="],
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
      )
      .map((identity) => ({ ...identity, launchMarker: readPosixLaunchMarker(identity.pid) }));
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
    const text = buffer.toString("utf8");
    if (start > 0) {
      const newline = text.indexOf("\n");
      return newline === -1 ? "" : text.slice(newline + 1);
    }
    return text;
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

type ProcessOwnership = "owned" | "local" | "gone" | "unknown";

const sameProcessIdentity = (expected: ProcessIdentity, actual: ProcessIdentity): boolean =>
  expected.pid === actual.pid &&
  expected.processGroupId === actual.processGroupId &&
  expected.sessionId === actual.sessionId &&
  expected.startToken === actual.startToken &&
  expected.launchMarker === actual.launchMarker &&
  expected.parentProcessId === actual.parentProcessId;

const groupOwnership = (
  reference: Extract<HandleReference, { readonly kind: "process" }>,
  record: InstanceRecord,
  runtime: ProcessLauncherRuntime,
  members: readonly ProcessIdentity[] | null,
  rootIdentity: ProcessIdentity | null,
): ProcessOwnership => {
  if (
    reference.processGroupId === null ||
    reference.sessionId === null ||
    members === null
  ) return "unknown";
  if (members.length === 0) return "gone";
  const roots = members.filter((member) => member.pid === reference.pid);
  const root = roots[0];
  if (rootIdentity) {
    if (roots.length !== 1 || !root) return "unknown";
  } else if (
    runtime.platform === "win32" ||
    reference.startToken === null ||
    roots.length !== 0 ||
    runtime.readIdentity(reference.pid) !== null
  ) {
    return "unknown";
  }
  const verifiedMembers = members
    .map((member) => {
      const identity = runtime.readIdentity(member.pid);
      return identity && sameProcessIdentity(member, identity) ? identity : null;
    })
    .filter((identity): identity is ProcessIdentity => identity !== null);
  if (verifiedMembers.length !== members.length) return "unknown";
  const verifiedRoot = verifiedMembers.find((member) => member.pid === reference.pid);
  if (rootIdentity) {
    if (!verifiedRoot || !sameProcessIdentity(rootIdentity, verifiedRoot)) return "unknown";
    if (
      rootIdentity.pid !== reference.pid ||
      rootIdentity.processGroupId !== reference.processGroupId ||
      rootIdentity.sessionId !== reference.sessionId ||
      (reference.startToken !== null && rootIdentity.startToken !== reference.startToken) ||
      (runtime.platform !== "win32" && rootIdentity.launchMarker !== record.nonce)
    ) return "unknown";
    if (
      verifiedRoot.processGroupId !== reference.processGroupId ||
      verifiedRoot.sessionId !== reference.sessionId ||
      verifiedRoot.startToken !== rootIdentity.startToken ||
      (reference.startToken !== null && verifiedRoot.startToken !== reference.startToken)
    ) return "unknown";
  } else if (verifiedRoot) {
    return "unknown";
  }
  if (verifiedMembers.some((member) => member.startToken.length === 0)) return "unknown";
  if (new Set(verifiedMembers.map((member) => member.pid)).size !== verifiedMembers.length) {
    return "unknown";
  }
  if (
    verifiedMembers.some(
      (member) =>
        member.processGroupId !== reference.processGroupId ||
        member.sessionId !== reference.sessionId,
    )
  ) return "unknown";
  if (
    runtime.platform !== "win32" &&
    verifiedMembers.some((member) => member.launchMarker !== record.nonce)
  ) {
    return "unknown";
  }
  if (rootIdentity) {
    const byPid = new Map(verifiedMembers.map((member) => [member.pid, member]));
    for (const member of verifiedMembers) {
      if (member.pid === reference.pid) continue;
      const visited = new Set<number>();
      let currentPid = member.pid;
      while (currentPid !== reference.pid) {
        if (visited.has(currentPid)) return "unknown";
        visited.add(currentPid);
        const current = byPid.get(currentPid);
        const parentProcessId = current?.parentProcessId;
        if (!current || parentProcessId === undefined || !Number.isSafeInteger(parentProcessId)) {
          return "unknown";
        }
        if (!byPid.has(parentProcessId)) return "unknown";
        currentPid = parentProcessId;
      }
    }
  }
  return "owned";
};

const ownership = (
  reference: HandleReference,
  record: InstanceRecord,
  runtime: ProcessLauncherRuntime,
  localChildren: ReadonlyMap<number, ChildProcess>,
): ProcessOwnership => {
  if (reference.kind !== "process" || !sameProcessReference(reference, record)) return "unknown";
  const child = localChildren.get(reference.pid);
  if (child && childRunning(child)) {
    if (runtime.platform === "win32" && reference.startToken === null) return "local";
    const identity = runtime.readIdentity(reference.pid);
    if (
      !identity ||
      identity.pid !== reference.pid ||
      identity.processGroupId !== reference.processGroupId ||
      identity.sessionId !== reference.sessionId ||
      (reference.startToken !== null && identity.startToken !== reference.startToken) ||
      (runtime.platform !== "win32" && identity.launchMarker !== record.nonce)
    ) return "unknown";
    return groupOwnership(
      reference,
      record,
      runtime,
      runtime.readGroup(reference.processGroupId ?? identity.processGroupId),
      identity,
    );
  }
  if (
    reference.processGroupId === null ||
    reference.sessionId === null
  ) return "unknown";
  const members = runtime.readGroup(reference.processGroupId);
  if (members === null) return "unknown";
  if (members?.length === 0) return "gone";
  if (reference.startToken === null) return "unknown";
  const rootIdentity = runtime.readIdentity(reference.pid);
  return groupOwnership(reference, record, runtime, members, rootIdentity);
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
            if (runtime.platform === "win32" || identity.launchMarker === record.nonce) {
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
        const child = localChildren.get(reference.pid);
        if (
          runtime.platform === "win32" &&
          reference.startToken === null &&
          child &&
          childRunning(child)
        ) {
          child.kill();
          const deadline = Date.now() + graceMs;
          while (Date.now() < deadline && childRunning(child)) {
            yield* Effect.sleep(STOP_POLL_MS);
          }
          if (childRunning(child)) child.kill("SIGKILL");
          return;
        }
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

    // Engines echo their configuration — vLLM prints its full serve command,
    // env assignments and all — and this tail lands verbatim in launch-failure
    // HTTP responses and SSE events, so it is redacted at the boundary. The
    // on-disk log file stays raw.
    logTail: (reference: HandleReference, record: InstanceRecord) =>
      Effect.sync(() => redactLogText(readTailBytes(logPathFor(record.name), LOG_TAIL_BYTES))),
  };
};
