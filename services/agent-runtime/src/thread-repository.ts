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
  listArchivedSessionMetadata,
  sessionSubagentLink,
  setSessionArchived,
  setSubagentLink,
} from "./session-metadata-store";
import {
  listSessions,
  loadSession,
  loadSessionWindow,
  type LoadSessionResult,
} from "./sessions-store";

export type ThreadArchiveMetadata = {
  cwd?: string | null;
  title?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  sessionUpdatedAt?: string | null;
};

export function listThreads(
  cwd: string,
  request: ThreadListRequest = {},
): Promise<ThreadSummary[]> {
  return listSessions(cwd, request);
}

export async function findThread(cwd: string, threadId: string): Promise<ThreadSummary | null> {
  const matches = await listSessions(cwd, { ids: [threadId], includeArchived: true });
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
        for (const summary of await listSessions(cwd, scoped)) {
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
  aggregated.sort(
    (a, b) =>
      new Date(b.startedAt || b.updatedAt).getTime() -
      new Date(a.startedAt || a.updatedAt).getTime(),
  );
  return aggregated;
}

export function readThreadWindow(
  cwd: string,
  threadId: string,
  request: ThreadWindowRequest = {},
): Promise<LoadSessionResult> {
  return loadSession(cwd, threadId, request);
}

export type ThreadWindowPage = LoadSessionResult & { window: ThreadWindow };

export async function readThreadWindowPage(
  cwd: string,
  threadId: string,
  request: ThreadWindowRequest = {},
): Promise<ThreadWindowPage> {
  const page =
    request.tail === undefined
      ? await loadSessionWindow(cwd, threadId, {
          before: request.before,
          maxTokens: request.maxTokens,
        })
      : await loadSession(cwd, threadId, { tail: request.tail, before: request.before });
  return {
    ...page,
    window: projectThreadWindow({
      threadId,
      found: page.found,
      events: page.windowEvents,
      cursor: page.cursor,
      meta: page.meta ? { ...page.meta, parent: threadParent(threadId) } : null,
    }),
  };
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

export function setThreadArchived(
  threadId: string,
  archived: boolean,
  now = new Date(),
  metadata?: ThreadArchiveMetadata,
): Promise<ThreadArchiveState> {
  return setSessionArchived(threadId, archived, now, metadata);
}
