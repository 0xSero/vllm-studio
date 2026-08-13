import type {
  ParentRelation,
  ProjectScopedThread,
  ThreadArchiveState,
  ThreadListRequest,
  ThreadSummary,
  ThreadWindow,
  ThreadWindowRequest,
} from "../../../shared/agent/thread";
import { projectThreadWindow } from "./thread-window-projector";
import { listProjectsFromStore, resolveAllowedWorkspace } from "./projects-store";
import {
  isProvisionalSession,
  isSessionArchived,
  listArchivedSessionMetadata,
  listThreadInventoryMetadata,
  markProvisionalSessionsMaterialized,
  registerProvisionalSession,
  sessionMetadataCwdMatches,
  sessionSubagentLink,
  setSessionArchived,
  setSubagentLink,
} from "./session-metadata-store";
import {
  listSessions,
  loadSession,
  loadSessionWindow,
  resolveSessionFile,
  type LoadSessionResult,
} from "./sessions-store";
import { emptyUsageTotals } from "./session-usage";

export type ThreadArchiveMetadata = {
  cwd?: string | null;
  title?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  sessionUpdatedAt?: string | null;
};

export type ProvisionalThread = {
  id: string;
  cwd: string;
  modelId: string | null;
  title: string | null;
  startedAt?: string;
  parentSessionId?: string | null;
  subagentName?: string | null;
};

function threadTime(thread: Pick<ThreadSummary, "startedAt" | "updatedAt">): number {
  const value = Date.parse(thread.startedAt || thread.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

function inventoryThreads(cwd: string, request: ThreadListRequest): ThreadSummary[] {
  const wantedIds = new Set((request.ids ?? []).map((id) => id.trim()).filter(Boolean));
  const since = request.since?.getTime();
  return listThreadInventoryMetadata().flatMap((thread) => {
    if (!sessionMetadataCwdMatches(thread.cwd, cwd)) return [];
    if (wantedIds.size > 0 && !wantedIds.has(thread.id)) return [];
    if (request.archivedOnly ? !thread.archived : thread.archived && !request.includeArchived) {
      return [];
    }
    const relevantTime = request.archivedOnly
      ? Date.parse(thread.archivedAt ?? thread.updatedAt)
      : Date.parse(thread.updatedAt);
    if (since !== undefined && relevantTime < since) return [];
    return [
      {
        id: thread.id,
        filename: "",
        cwd: thread.cwd,
        startedAt: thread.startedAt,
        updatedAt: thread.updatedAt,
        modelId: thread.modelId,
        provider: null,
        firstUserMessage: thread.title,
        archived: thread.archived,
        archivedAt: thread.archivedAt,
        parentSessionId: thread.parentSessionId,
        subagentName: thread.subagentName,
      },
    ];
  });
}

export async function listThreads(
  cwd: string,
  request: ThreadListRequest = {},
): Promise<ThreadSummary[]> {
  const inventory = inventoryThreads(cwd, request);
  const durable = await listSessions(cwd, request);
  const inventoryIds = new Set(
    inventoryThreads(cwd, { includeArchived: true }).map((thread) => thread.id),
  );
  await markProvisionalSessionsMaterialized(
    durable.flatMap((thread) => (inventoryIds.has(thread.id) ? [thread.id] : [])),
  );
  const merged = new Map(inventory.map((thread) => [thread.id, thread]));
  for (const thread of durable) merged.set(thread.id, thread);
  const threads = [...merged.values()].sort((a, b) => threadTime(b) - threadTime(a));
  return request.limit && request.limit > 0 ? threads.slice(0, request.limit) : threads;
}

export async function findThread(cwd: string, threadId: string): Promise<ThreadSummary | null> {
  const matches = await listThreads(cwd, { ids: [threadId], includeArchived: true });
  return matches.find((thread) => thread.id === threadId) ?? null;
}

export async function listThreadsAcrossProjects(
  request: ThreadListRequest = {},
): Promise<ProjectScopedThread[]> {
  const scoped: ThreadListRequest = request.archivedOnly
    ? { ...request, since: undefined }
    : request;
  const aggregated: ProjectScopedThread[] = [];
  const seenIds = new Set<string>();
  await Promise.all(
    listProjectsFromStore().map(async (project) => {
      try {
        const cwd = resolveAllowedWorkspace(project.path);
        for (const summary of await listThreads(cwd, scoped)) {
          seenIds.add(summary.id);
          aggregated.push({
            ...summary,
            projectId: project.id,
            projectName: project.name,
            projectPath: project.path,
          });
        }
      } catch {
        return;
      }
    }),
  );
  if (request.archivedOnly) {
    for (const metadata of listArchivedSessionMetadata()) {
      if (seenIds.has(metadata.id)) continue;
      aggregated.push({
        id: metadata.id,
        filename: "",
        cwd: metadata.cwd ?? "",
        startedAt: metadata.sessionUpdatedAt ?? metadata.archivedAt ?? metadata.updatedAt ?? "",
        updatedAt: metadata.sessionUpdatedAt ?? metadata.updatedAt ?? metadata.archivedAt ?? "",
        modelId: null,
        provider: null,
        firstUserMessage: metadata.title,
        archived: true,
        archivedAt: metadata.archivedAt,
        parentSessionId: null,
        subagentName: null,
        projectId: metadata.projectId ?? "",
        projectName: metadata.projectName ?? "Unknown project",
        projectPath: metadata.cwd ?? "",
      });
    }
  }
  aggregated.sort((a, b) => threadTime(b) - threadTime(a));
  return aggregated;
}

function provisionalThreadResult(cwd: string, threadId: string): LoadSessionResult | null {
  if (!isProvisionalSession(cwd, threadId)) return null;
  const summary = inventoryThreads(cwd, { ids: [threadId] })[0];
  if (!summary) return null;
  return {
    events: [],
    cursor: null,
    found: true,
    windowEvents: [
      {
        type: "custom",
        id: `provisional:${summary.id}`,
        parentId: null,
        timestamp: summary.startedAt,
        customType: "provisional",
      },
    ],
    meta: {
      title: summary.firstUserMessage,
      modelId: summary.modelId,
      startedAt: summary.startedAt,
      piSessionId: summary.id,
      usage: emptyUsageTotals(),
    },
  };
}

export async function readThreadWindow(
  cwd: string,
  threadId: string,
  request: ThreadWindowRequest = {},
): Promise<LoadSessionResult> {
  const result = await loadSession(cwd, threadId, request);
  return result.found ? result : (provisionalThreadResult(cwd, threadId) ?? result);
}

export async function readThreadPage(
  cwd: string,
  threadId: string,
  request: ThreadWindowRequest = {},
): Promise<LoadSessionResult> {
  const result = await (request.tail === undefined
    ? loadSessionWindow(cwd, threadId, {
        before: request.before,
        maxTokens: request.maxTokens,
      })
    : loadSession(cwd, threadId, { tail: request.tail, before: request.before }));
  return result.found ? result : (provisionalThreadResult(cwd, threadId) ?? result);
}

export function projectThreadPage(threadId: string, page: LoadSessionResult): ThreadWindow {
  return projectThreadWindow({
    threadId,
    found: page.found,
    events: page.windowEvents,
    cursor: page.cursor,
    meta: page.meta ? { ...page.meta, parent: threadParent(threadId) } : null,
  });
}

export function threadParent(threadId: string): ParentRelation | null {
  return sessionSubagentLink(threadId);
}

export function linkThreadParent(
  childThreadId: string,
  parentThreadId: string,
  subagentName: string | null,
): Promise<void> {
  return setSubagentLink(childThreadId, parentThreadId, subagentName);
}

export function registerProvisionalThread(thread: ProvisionalThread): Promise<void> {
  const resolution = resolveSessionFile(thread.cwd, thread.id);
  if (resolution.kind === "found") return Promise.resolve();
  if (resolution.kind === "missing") return registerProvisionalSession(thread);
  return Promise.reject(new Error(`Session '${thread.id}' is ${resolution.kind}.`));
}

export function canResumeProvisionalThread(cwd: string, threadId: string): boolean {
  return isProvisionalSession(cwd, threadId);
}

export function canOpenThread(threadId: string): boolean {
  return !isSessionArchived(threadId);
}

export function setThreadArchived(
  threadId: string,
  archived: boolean,
  now = new Date(),
  metadata?: ThreadArchiveMetadata,
): Promise<ThreadArchiveState> {
  return setSessionArchived(threadId, archived, now, metadata);
}
