import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import { notifySessionListChanged } from "./session-list-changed";
import lockfile from "proper-lockfile";
import { resolveDataDir } from "./data-dir";
import { isRecord } from "../../../shared/agent/guards";
import type { PersistedValue } from "./session-json-store";

const SESSION_METADATA_FILENAME = "agent-session-metadata.json";
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_ATTEMPTS = 80;

export type SessionArchiveState = {
  archived: boolean;
  archivedAt: string | null;
};

type StoredSessionMetadata = {
  archived?: boolean;
  archivedAt?: string | null;
  updatedAt?: string;
  cwd?: string;
  title?: string | null;
  projectId?: string;
  projectName?: string;
  sessionUpdatedAt?: string;
  parentSessionId?: string;
  subagentName?: string;
  subagentRunId?: string;
  subagentTask?: string;
};

type SessionMetadataStore = {
  version: 1;
  sessions: Record<string, StoredSessionMetadata>;
};

export type ArchivedSessionMetadata = SessionArchiveState & {
  id: string;
  updatedAt: string | null;
  cwd: string | null;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  sessionUpdatedAt: string | null;
};

type SessionArchiveMetadataInput = {
  cwd?: string | null;
  title?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  sessionUpdatedAt?: string | null;
};

function defaultStore(): SessionMetadataStore {
  return { version: 1, sessions: {} };
}

function storePath(): string {
  return path.join(resolveDataDir(), SESSION_METADATA_FILENAME);
}

const isString = Schema.is(Schema.String);

function normalizeStoredMetadata(metadata: PersistedValue): StoredSessionMetadata | null {
  if (!isRecord(metadata)) return null;
  return {
    archived: metadata.archived === true,
    archivedAt: isString(metadata.archivedAt) ? metadata.archivedAt : null,
    updatedAt: isString(metadata.updatedAt) ? metadata.updatedAt : undefined,
    cwd: isString(metadata.cwd) ? metadata.cwd : undefined,
    title: isString(metadata.title) ? metadata.title : null,
    projectId: isString(metadata.projectId) ? metadata.projectId : undefined,
    projectName: isString(metadata.projectName) ? metadata.projectName : undefined,
    sessionUpdatedAt: isString(metadata.sessionUpdatedAt) ? metadata.sessionUpdatedAt : undefined,
    parentSessionId: isString(metadata.parentSessionId) ? metadata.parentSessionId : undefined,
    subagentName: isString(metadata.subagentName) ? metadata.subagentName : undefined,
    subagentRunId: isString(metadata.subagentRunId) ? metadata.subagentRunId : undefined,
    subagentTask: isString(metadata.subagentTask) ? metadata.subagentTask : undefined,
  };
}

function normalizeStore(value: PersistedValue): SessionMetadataStore {
  if (!isRecord(value) || !isRecord(value.sessions)) return defaultStore();
  const sessions: Record<string, StoredSessionMetadata> = {};
  for (const [id, metadata] of Object.entries(value.sessions)) {
    if (!id.trim()) continue;
    const normalized = normalizeStoredMetadata(metadata);
    if (normalized) sessions[id] = normalized;
  }
  return { version: 1, sessions };
}

function backupUnreadableStore(filepath: string): void {
  if (!existsSync(filepath)) return;
  const backupPath = `${filepath}.corrupt-${Date.now()}.bak`;
  try {
    renameSync(filepath, backupPath);
    console.warn(`[agent-session-metadata] Moved unreadable metadata store to ${backupPath}`);
  } catch (error) {
    console.warn("[agent-session-metadata] Failed to preserve unreadable metadata store", error);
  }
}

function readStore(): SessionMetadataStore {
  const filepath = storePath();
  try {
    if (!existsSync(filepath)) return defaultStore();
    return normalizeStore(JSON.parse(readFileSync(filepath, "utf-8")));
  } catch (error) {
    backupUnreadableStore(filepath);
    console.warn("[agent-session-metadata] Failed to read metadata store", error);
    return defaultStore();
  }
}

function writeStore(store: SessionMetadataStore): void {
  const filepath = storePath();
  mkdirSync(path.dirname(filepath), { recursive: true });
  const tempPath = `${filepath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  try {
    chmodSync(tempPath, 0o600);
  } catch {}
  renameSync(tempPath, filepath);
  notifySessionListChanged();
}

async function withStoreLock<T>(callback: () => T): Promise<T> {
  const filepath = storePath();
  mkdirSync(path.dirname(filepath), { recursive: true });
  const release = await lockfile.lock(filepath, {
    realpath: false,
    stale: LOCK_STALE_MS,
    retries: {
      retries: LOCK_ATTEMPTS - 1,
      factor: 1,
      minTimeout: LOCK_RETRY_MS,
      maxTimeout: LOCK_RETRY_MS,
      randomize: false,
    },
  });
  try {
    return callback();
  } finally {
    await release();
  }
}

function cleanOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function applyMetadataInput(
  current: StoredSessionMetadata,
  metadata?: SessionArchiveMetadataInput,
): StoredSessionMetadata {
  if (!metadata) return current;
  const next = { ...current };
  const cwd = cleanOptionalString(metadata.cwd);
  const title = cleanOptionalString(metadata.title);
  const projectId = cleanOptionalString(metadata.projectId);
  const projectName = cleanOptionalString(metadata.projectName);
  const sessionUpdatedAt = cleanOptionalString(metadata.sessionUpdatedAt);
  if (cwd) next.cwd = cwd;
  if (title) next.title = title;
  if (projectId) next.projectId = projectId;
  if (projectName) next.projectName = projectName;
  if (sessionUpdatedAt) next.sessionUpdatedAt = sessionUpdatedAt;
  return next;
}

export type SessionSubagentLink = {
  parentSessionId: string;
  subagentName: string | null;
};

export type SessionListMetadata = SessionArchiveState & {
  parentSessionId: string | null;
  subagentName: string | null;
};

export function readSessionListMetadata(): (sessionId: string) => SessionListMetadata {
  const sessions = readStore().sessions;
  return (sessionId) => {
    const metadata = sessions[sessionId];
    return {
      archived: metadata?.archived === true,
      archivedAt: metadata?.archived === true ? (metadata.archivedAt ?? null) : null,
      parentSessionId: metadata?.parentSessionId ?? null,
      subagentName: metadata?.subagentName ?? null,
    };
  };
}

export function sessionSubagentLink(sessionId: string): SessionSubagentLink | null {
  const metadata = readStore().sessions[sessionId];
  if (!metadata?.parentSessionId) return null;
  return {
    parentSessionId: metadata.parentSessionId,
    subagentName: metadata.subagentName ?? null,
  };
}

export async function setSubagentLink(
  childSessionId: string,
  parentSessionId: string,
  subagentName: string | null,
  run?: { runId?: string; cwd?: string; task?: string },
): Promise<void> {
  const childId = childSessionId.trim();
  const parentId = parentSessionId.trim();
  if (!childId || !parentId || childId === parentId) return;
  await withStoreLock(() => {
    const store = readStore();
    const current = store.sessions[childId] ?? {};
    const next: StoredSessionMetadata = {
      ...current,
      parentSessionId: parentId,
      updatedAt: new Date().toISOString(),
    };
    const name = subagentName?.trim();
    const runId = run?.runId?.trim();
    const cwd = run?.cwd?.trim();
    const task = run?.task?.trim();
    if (name) next.subagentName = name;
    if (runId) next.subagentRunId = runId;
    if (cwd) next.cwd = cwd;
    if (task) next.subagentTask = task;
    store.sessions[childId] = next;
    writeStore(store);
  });
}

export type StoredSubagentChild = {
  childSessionId: string;
  parentSessionId: string;
  subagentName: string | null;
  runId: string | null;
  cwd: string | null;
  task: string | null;
  updatedAt: string | null;
};

export function listSubagentChildren(parentSessionId: string): StoredSubagentChild[] {
  const parentId = parentSessionId.trim();
  if (!parentId) return [];
  return Object.entries(readStore().sessions)
    .filter(([, metadata]) => metadata.parentSessionId === parentId)
    .map(([childSessionId, metadata]) => ({
      childSessionId,
      parentSessionId: parentId,
      subagentName: metadata.subagentName ?? null,
      runId: metadata.subagentRunId ?? null,
      cwd: metadata.cwd ?? null,
      task: metadata.subagentTask ?? null,
      updatedAt: metadata.updatedAt ?? null,
    }));
}

export function listArchivedSessionMetadata(): ArchivedSessionMetadata[] {
  return Object.entries(readStore().sessions)
    .filter(([, metadata]) => metadata.archived === true)
    .map(([id, metadata]) => ({
      id,
      archived: true,
      archivedAt: metadata.archivedAt ?? null,
      updatedAt: metadata.updatedAt ?? null,
      cwd: metadata.cwd ?? null,
      title: metadata.title ?? null,
      projectId: metadata.projectId ?? null,
      projectName: metadata.projectName ?? null,
      sessionUpdatedAt: metadata.sessionUpdatedAt ?? null,
    }))
    .sort((a, b) => {
      const aTime = Date.parse(a.archivedAt ?? a.updatedAt ?? a.sessionUpdatedAt ?? "");
      const bTime = Date.parse(b.archivedAt ?? b.updatedAt ?? b.sessionUpdatedAt ?? "");
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
}

export async function setSessionArchived(
  sessionId: string,
  archived: boolean,
  now = new Date(),
  metadata?: SessionArchiveMetadataInput,
): Promise<SessionArchiveState> {
  const id = sessionId.trim();
  if (!id) return { archived: false, archivedAt: null };
  return withStoreLock(() => {
    const store = readStore();
    const current = store.sessions[id] ?? {};
    const archivedAt = archived ? (current.archivedAt ?? now.toISOString()) : null;
    if (archived) {
      store.sessions[id] = applyMetadataInput(
        {
          ...current,
          archived: true,
          archivedAt,
          updatedAt: now.toISOString(),
        },
        metadata,
      );
    } else if (current.parentSessionId) {
      store.sessions[id] = {
        ...current,
        archived: false,
        archivedAt: null,
        updatedAt: now.toISOString(),
      };
    } else {
      delete store.sessions[id];
    }
    for (const [childId, child] of Object.entries(store.sessions)) {
      if (child.parentSessionId !== id || childId === id) continue;
      store.sessions[childId] = {
        ...child,
        archived,
        archivedAt: archived ? (child.archivedAt ?? now.toISOString()) : null,
        updatedAt: now.toISOString(),
      };
    }
    writeStore(store);
    return { archived, archivedAt };
  });
}
