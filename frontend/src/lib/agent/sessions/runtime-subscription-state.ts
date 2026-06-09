export function shouldSubscribeRuntimeEvents(status: string): boolean {
  return status === "running";
}

export function mirrorSessionLastEventSeq(
  _current: number | undefined,
  sessionLastEventSeq: number | undefined,
): number | undefined {
  return sessionLastEventSeq;
}

export function shouldApplyRuntimeSeq(current: number | undefined, seq: number | undefined) {
  if (typeof seq !== "number") return { apply: true, next: current };
  const previous = current ?? 0;
  if (seq <= previous) return { apply: false, next: previous };
  return { apply: true, next: seq };
}
