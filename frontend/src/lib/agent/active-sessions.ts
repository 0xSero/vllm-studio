import type { ComposerPluginRef, ComposerSkillRef } from "./composer-context";

export type ActiveAgentSessionSnapshot = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  piSessionId: string | null;
  modelId?: string;
  title: string;
  status: string;
  active?: boolean;
  startedAt?: string;
  updatedAt: string;
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
};

export type ActiveSessionPrefs = Record<string, { hidden?: boolean }>;

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

function updateTime(session: ActiveAgentSessionSnapshot): number {
  const value = Date.parse(session.updatedAt);
  return Number.isFinite(value) ? value : startTime(session);
}

function normalizeSingleActive(
  sessions: ActiveAgentSessionSnapshot[],
): ActiveAgentSessionSnapshot[] {
  const active = sessions.filter((session) => session.active);
  if (active.length <= 1) return sessions;
  const keep = active.reduce((latest, session) =>
    updateTime(session) > updateTime(latest) ? session : latest,
  );
  return sessions.map((session) => (session === keep ? session : { ...session, active: false }));
}

export function mergeActiveAgentSessions(
  previous: ActiveAgentSessionSnapshot[],
  incoming: ActiveAgentSessionSnapshot[],
  prefs: ActiveSessionPrefs = {},
): ActiveAgentSessionSnapshot[] {
  const byKey = new Map<string, ActiveAgentSessionSnapshot>();
  const incomingKeys = new Set<string>();
  for (const session of previous) {
    if (!isHidden(session, prefs)) byKey.set(sessionStorageKey(session), session);
  }
  for (const session of incoming) {
    if (isHidden(session, prefs)) continue;
    const tabKey = `tab:${session.paneId}:${session.tabId}`;
    const existingTab = byKey.get(tabKey);
    const existingPiKey = [...byKey.entries()].find(
      ([, value]) =>
        value.paneId === session.paneId && value.tabId === session.tabId && value.piSessionId,
    )?.[0];
    if (session.piSessionId) byKey.delete(tabKey);
    const key = session.piSessionId ? `pi:${session.piSessionId}` : (existingPiKey ?? tabKey);
    const existing = byKey.get(key) ?? existingTab;
    const existingFromIncoming =
      incomingKeys.has(key) ||
      incomingKeys.has(tabKey) ||
      Boolean(existingPiKey && incomingKeys.has(existingPiKey));
    if (existing?.active && !session.active && existingFromIncoming) {
      byKey.set(key, {
        ...existing,
        title: session.title || existing.title,
        status: session.status || existing.status,
        updatedAt: session.updatedAt || existing.updatedAt,
        piSessionId: session.piSessionId ?? existing.piSessionId ?? null,
        startedAt: existing.startedAt ?? session.startedAt ?? session.updatedAt,
        plugins: session.plugins ?? existing.plugins,
        skills: session.skills ?? existing.skills,
      });
    } else {
      byKey.set(key, {
        ...existing,
        ...session,
        piSessionId: session.piSessionId ?? existing?.piSessionId ?? null,
        startedAt: existing?.startedAt ?? session.startedAt ?? session.updatedAt,
        plugins: session.plugins ?? existing?.plugins,
        skills: session.skills ?? existing?.skills,
      });
    }
    incomingKeys.add(key);
  }
  return normalizeSingleActive([...byKey.values()].sort((a, b) => startTime(b) - startTime(a)));
}
