type RuntimePromptStreamOwner = {
  controller: AbortController;
  ownerId: string;
};

const runtimePromptStreams = new Map<string, RuntimePromptStreamOwner>();
const runtimePromptStreamListeners = new Set<() => void>();
let runtimePromptStreamVersion = 0;

function notifyRuntimePromptStreamListeners(): void {
  runtimePromptStreamVersion += 1;
  for (const listener of runtimePromptStreamListeners) listener();
}

export function claimRuntimePromptStream(
  runtimeSessionId: string,
  ownerId: string,
  controller: AbortController,
): void {
  const existing = runtimePromptStreams.get(runtimeSessionId);
  if (existing && existing.ownerId !== ownerId) {
    existing.controller.abort();
  }
  runtimePromptStreams.set(runtimeSessionId, { controller, ownerId });
  notifyRuntimePromptStreamListeners();
}

export function releaseRuntimePromptStream(runtimeSessionId: string, ownerId: string): void {
  const existing = runtimePromptStreams.get(runtimeSessionId);
  if (existing?.ownerId === ownerId) {
    runtimePromptStreams.delete(runtimeSessionId);
    notifyRuntimePromptStreamListeners();
  }
}

export function hasRuntimePromptStream(runtimeSessionId: string): boolean {
  return runtimePromptStreams.has(runtimeSessionId);
}

export function subscribeRuntimePromptStreams(listener: () => void): () => void {
  runtimePromptStreamListeners.add(listener);
  return () => runtimePromptStreamListeners.delete(listener);
}

export function runtimePromptStreamsSnapshot(): number {
  return runtimePromptStreamVersion;
}
