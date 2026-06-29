import type { ComposerSkillRef } from "@/features/agent/composer-context";

export type ActiveAgentSessionSnapshot = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  runtimeSessionId: string;
  piSessionId: string | null;
  modelId?: string;
  title: string;
  status: string;
  focused?: boolean;
  /**
   * The session produced activity (streaming, or it just finished) while it was
   * NOT the focused session — i.e. there's something the user hasn't looked at.
   * Set when a non-focused session is active or transitions to settled; cleared
   * the moment the session becomes focused. Drives the sidebar "unseen" dot.
   */
  unseen?: boolean;
  startedAt?: string;
  updatedAt: string;
  skills?: ComposerSkillRef[];
  usedSkills?: ComposerSkillRef[];
  /**
   * Identifies the app instance (window) that wrote this entry. The persist path
   * stamps every entry it writes; on the next write the merge drops THIS
   * instance's previously-persisted entries (its `incoming` set is authoritative,
   * so an entry it no longer lists was closed) while keeping entries written by
   * other instances (cross-window union). Legacy entries written before this
   * field existed have no writerId and are preserved.
   */
  writerId?: string;
};

export type ActiveSessionPrefs = Record<string, { hidden?: boolean; pinned?: boolean }>;

type MergeTarget = {
  key: string;
  existing?: ActiveAgentSessionSnapshot;
};

function sessionStorageKey(session: ActiveAgentSessionSnapshot): string {
  return session.piSessionId
    ? `pi:${session.piSessionId}`
    : `tab:${session.paneId}:${session.tabId}`;
}

function isHidden(session: ActiveAgentSessionSnapshot, prefs: ActiveSessionPrefs): boolean {
  return Boolean(session.piSessionId && prefs[session.piSessionId]?.hidden);
}

function startTime(session: ActiveAgentSessionSnapshot): number {
  const value = Date.parse(session.startedAt ?? session.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

function findPiKeyForTab(
  byKey: Map<string, ActiveAgentSessionSnapshot>,
  session: ActiveAgentSessionSnapshot,
): string | undefined {
  return [...byKey.entries()].find(
    ([, value]) =>
      value.paneId === session.paneId && value.tabId === session.tabId && value.piSessionId,
  )?.[0];
}

function resolveMergeTarget(
  byKey: Map<string, ActiveAgentSessionSnapshot>,
  session: ActiveAgentSessionSnapshot,
): MergeTarget {
  const tabKey = `tab:${session.paneId}:${session.tabId}`;
  const existingTab = byKey.get(tabKey);
  const existingPiKey = findPiKeyForTab(byKey, session);
  if (session.piSessionId) byKey.delete(tabKey);
  const key = session.piSessionId ? `pi:${session.piSessionId}` : (existingPiKey ?? tabKey);
  return {
    key,
    existing: byKey.get(key) ?? existingTab,
  };
}

function preferDefined<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function preferNullable<T>(value: T | null | undefined, fallback: T | null): T | null {
  return value ?? fallback;
}

function isActiveStatus(status: string): boolean {
  return status !== "idle" && status !== "done" && status !== "";
}

function nextUnseen(
  session: ActiveAgentSessionSnapshot,
  existing: ActiveAgentSessionSnapshot | undefined,
): boolean {
  // Focusing a session means the user is now looking at it — nothing unseen.
  if (session.focused === true) return false;
  // Sticky once set, until the session is focused again.
  if (existing?.unseen) return true;
  // A non-focused session that is currently working, or whose activity just
  // advanced (new content / a settle transition) since we last saw it, has
  // something unseen.
  if (isActiveStatus(session.status)) return true;
  if (existing && session.updatedAt !== existing.updatedAt) return true;
  if (existing && isActiveStatus(existing.status) && !isActiveStatus(session.status)) return true;
  return false;
}

function applyIncomingSnapshot(
  session: ActiveAgentSessionSnapshot,
  target: MergeTarget,
): ActiveAgentSessionSnapshot {
  return {
    ...target.existing,
    ...session,
    unseen: nextUnseen(session, target.existing),
    piSessionId: preferNullable(session.piSessionId, target.existing?.piSessionId ?? null),
    runtimeSessionId:
      session.runtimeSessionId || target.existing?.runtimeSessionId || session.tabId,
    startedAt: preferDefined(
      target.existing?.startedAt,
      preferDefined(session.startedAt, session.updatedAt),
    ),
    skills: preferDefined(session.skills, target.existing?.skills),
    usedSkills: preferDefined(session.usedSkills, target.existing?.usedSkills),
  };
}

export function mergeActiveAgentSessions(
  previous: ActiveAgentSessionSnapshot[],
  incoming: ActiveAgentSessionSnapshot[],
  prefs: ActiveSessionPrefs = {},
  ownWriterId?: string,
): ActiveAgentSessionSnapshot[] {
  const byKey = new Map<string, ActiveAgentSessionSnapshot>();
  let focusedKey: string | null = null;
  for (const session of previous) {
    // `incoming` is the authoritative current set for THIS app instance, so its
    // own previously-persisted entries are replaced wholesale below — a previous
    // entry this instance no longer lists was closed/pruned and must not linger.
    // Entries from other instances (or legacy ones with no writerId) are kept.
    if (ownWriterId && session.writerId === ownWriterId) continue;
    if (!isHidden(session, prefs)) byKey.set(sessionStorageKey(session), session);
  }
  for (const session of incoming) {
    if (isHidden(session, prefs)) continue;
    const target = resolveMergeTarget(byKey, session);
    byKey.set(target.key, applyIncomingSnapshot(session, target));
    if (session.focused === true) focusedKey = target.key;
  }
  return normalizeFocusedSession(
    [...byKey.values()].sort((a, b) => startTime(b) - startTime(a)),
    focusedKey,
  );
}

function normalizeFocusedSession(
  sessions: ActiveAgentSessionSnapshot[],
  preferredKey: string | null,
): ActiveAgentSessionSnapshot[] {
  const focusedKey = preferredKey ?? firstFocusedSessionKey(sessions);
  if (!focusedKey) return sessions;
  return sessions.map((session) => {
    const focused = sessionStorageKey(session) === focusedKey;
    // The focused session is being looked at — it can never be "unseen".
    const unseen = focused ? false : session.unseen;
    if (session.focused === focused && session.unseen === unseen) return session;
    return { ...session, focused, unseen };
  });
}

function firstFocusedSessionKey(sessions: ActiveAgentSessionSnapshot[]): string | null {
  const focused = sessions.find((session) => session.focused === true);
  return focused ? sessionStorageKey(focused) : null;
}
