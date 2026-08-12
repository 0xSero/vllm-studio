import type { RuntimeStatus } from "@/features/agent/runtime/api";
import type { Session } from "./types";

const WORKING_SESSION_STATUSES: readonly string[] = ["starting", "running", "stopping", "loading"];

export function isWorkingStatus(status: string): boolean {
  return WORKING_SESSION_STATUSES.includes(status);
}

export function settleTurn(session: Session): Session {
  return { ...session, status: "idle", activeAssistantId: undefined };
}

export function projectRuntimeStatus(session: Session, status: RuntimeStatus): Session {
  if (session.status === "loading") return session;
  const snapshot = status.messages ?? session.messages;
  const pending = session.messages.filter(
    (message) =>
      (message.pending || message.awaitingEcho) &&
      !snapshot.some(
        (candidate) =>
          candidate.role === message.role && candidate.text.trim() === message.text.trim(),
      ),
  );
  const messages = [...snapshot, ...pending];
  const next: Session = {
    ...session,
    messages,
    ...(status.tokenStats ? { tokenStats: status.tokenStats } : {}),
    ...(status.historyCursor !== undefined ? { historyCursor: status.historyCursor } : {}),
    ...(status.title ? { title: status.title } : {}),
    ...(status.startedAt ? { startedAt: status.startedAt } : {}),
    ...(status.usageTotals ? { usageTotals: status.usageTotals } : {}),
    ...(status.error !== undefined ? { error: status.error ?? "" } : {}),
    ...(status.piSessionId ? { piSessionId: status.piSessionId } : {}),
    ...(status.modelId ? { modelId: status.modelId } : {}),
    ...(status.contextUsage !== undefined ? { contextUsage: status.contextUsage } : {}),
    ...(status.queue ? { queue: [...status.queue.followUp] } : {}),
    extensionUiRequest: status.extensionUiRequest ?? undefined,
  };
  if (status.active === true) {
    return {
      ...next,
      status: session.status === "stopping" ? "stopping" : "running",
      activeAssistantId: [...messages].reverse().find((message) => message.role === "assistant")
        ?.id,
    };
  }
  const settled = {
    ...next,
    messages: messages.map((message) =>
      message.pending || message.awaitingEcho
        ? { ...message, pending: false, awaitingEcho: false }
        : message,
    ),
  };
  return session.status === "running" || session.status === "stopping"
    ? settleTurn(settled)
    : settled;
}
