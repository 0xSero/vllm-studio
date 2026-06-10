import { runtimeStatusLooksActive } from "@/features/agent/messages";
import type { RuntimeStatus } from "@/features/agent/runtime/api";
import type { Session } from "@/features/agent/runtime/types";

export function resolveRuntimeSessionId(
  session: Pick<Session, "runtimeSessionId"> | null | undefined,
  fallbackRuntimeSessionId: string,
): string {
  return session?.runtimeSessionId || fallbackRuntimeSessionId;
}

export function runtimeIsActiveForPiSession(
  runtimeStatus: RuntimeStatus | null | undefined,
  piSessionId: string | null | undefined,
): boolean {
  return Boolean(
    runtimeStatus &&
    runtimeStatusLooksActive(runtimeStatus) &&
    (!runtimeStatus.piSessionId || !piSessionId || runtimeStatus.piSessionId === piSessionId),
  );
}

export function runtimeCanHydrateCanonicalSession(
  runtimeStatus: RuntimeStatus | null | undefined,
  piSessionId: string,
): boolean {
  return Boolean(
    runtimeStatus?.active === true &&
    (!runtimeStatus.piSessionId || runtimeStatus.piSessionId === piSessionId),
  );
}
