export type RuntimeLookupEntry<TSession> = {
  sessionId: string;
  session: TSession;
};

export function findRuntimeSessionForLookup<
  TSession extends { status: { piSessionId?: string | null } },
>(
  entries: Iterable<RuntimeLookupEntry<TSession>>,
  sessionId: string,
  piSessionId?: string | null,
): RuntimeLookupEntry<TSession> | null {
  const snapshot = [...entries];
  const target = piSessionId?.trim();
  if (target) {
    const piMatch = snapshot.find((entry) => entry.session.status.piSessionId === target);
    if (piMatch) return piMatch;
  }
  return snapshot.find((entry) => entry.sessionId === sessionId) ?? null;
}
