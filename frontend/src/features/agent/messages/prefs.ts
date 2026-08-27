import { Effect } from "effect";
import {
  dispatchWorkbenchCommand,
  getWorkbenchProjection,
} from "@/features/workbench/controller-state";

export type SessionPref = {
  title?: string;
  pinned?: boolean;
  hidden?: boolean;
};

export type SessionPrefs = Record<string, SessionPref>;

const PROJECT_PIN_PREFIX = "project:";

export function loadSessionPrefs(): SessionPrefs {
  const projection = getWorkbenchProjection();
  const prefs: SessionPrefs = {};
  for (const task of projection.tasks) {
    prefs[task.id] = {
      ...(task.title !== task.id ? { title: task.title } : {}),
      ...(task.pinned ? { pinned: true } : {}),
      ...(task.connection === "archived" ? { hidden: true } : {}),
    };
  }
  for (const project of projection.projects) {
    if (project.pinned) prefs[`${PROJECT_PIN_PREFIX}${project.id}`] = { pinned: true };
  }
  return prefs;
}

export async function hydrateSessionPrefsFromDesktop(): Promise<void> {
  return Promise.resolve();
}

export function patchSessionPref(taskId: string, patch: SessionPref): void {
  patchCanonicalSessionPref(taskId, [], patch);
}

function hasSessionPref(pref: SessionPref): boolean {
  return Boolean(pref.title || pref.pinned || pref.hidden);
}

function applyTaskPatch(taskId: string, previous: SessionPref, next: SessionPref): void {
  if (next.title !== previous.title) {
    void Effect.runPromise(
      dispatchWorkbenchCommand({
        kind: "rename_task",
        taskId,
        title: next.title?.trim() || taskId,
      }),
    );
  }
  if (next.pinned !== previous.pinned) {
    void Effect.runPromise(
      dispatchWorkbenchCommand({
        kind: "pin_task",
        taskId,
        pinned: Boolean(next.pinned),
      }),
    );
  }
  if (next.hidden && !previous.hidden) {
    void Effect.runPromise(
      dispatchWorkbenchCommand({
        kind: "archive_task",
        taskId,
      }),
    );
  }
}

export function patchCanonicalSessionPref(
  primaryKey: string,
  aliasKeys: readonly string[],
  patch: SessionPref = {},
): void {
  if (!primaryKey) return;
  const prefs = loadSessionPrefs();
  const key = [primaryKey, ...aliasKeys].find((candidate) => candidate in prefs) ?? primaryKey;
  const previous = prefs[key] ?? {};
  const next = { ...previous, ...patch };
  if (primaryKey.startsWith(PROJECT_PIN_PREFIX)) {
    void Effect.runPromise(
      dispatchWorkbenchCommand({
        kind: "pin_project",
        projectId: primaryKey.slice(PROJECT_PIN_PREFIX.length),
        pinned: Boolean(next.pinned),
      }),
    );
    return;
  }
  if (hasSessionPref(next) || hasSessionPref(previous)) applyTaskPatch(key, previous, next);
}

export function isLocalSessionPrefKey(key: string): boolean {
  return key.startsWith("tab:") || key.startsWith("tab-");
}
