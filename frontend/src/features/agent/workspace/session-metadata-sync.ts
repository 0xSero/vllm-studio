import type { SessionMetadata } from "@local-studio/contracts/federation";
import { createHeadApiClient, getHeadConnection } from "@/lib/api/head-controller";
import { readLocalProfile } from "@/features/shell/local-profile";
import type { Session, SessionsMap } from "@/features/agent/runtime/types";

const DESKTOP_ID_KEY = "local-studio:desktop-id";
const signatures = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const desktopId = (): string => {
  const existing = window.localStorage.getItem(DESKTOP_ID_KEY)?.trim();
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(DESKTOP_ID_KEY, created);
  return created;
};

const projectName = (path: string | undefined): string | null => {
  if (!path) return null;
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
};

const sessionMetadata = (session: Session): SessionMetadata => {
  const profile = readLocalProfile();
  const lastMessage = [...session.messages]
    .reverse()
    .find((message) => message.role === "user" || message.role === "assistant");
  const attachments = session.messages.flatMap((message) => message.attachments ?? []);
  const uniqueAttachments = new Map<string, (typeof attachments)[number]>();
  for (const attachment of attachments) {
    uniqueAttachments.set(
      `${attachment.path ?? ""}:${attachment.name}:${attachment.size}`,
      attachment,
    );
  }
  const usage = session.usageTotals;
  return {
    session_id: session.id,
    pi_session_id: session.piSessionId,
    desktop_id: desktopId(),
    desktop_name: profile.name.trim() || "Studio",
    project_id: session.projectId ?? null,
    project_name: projectName(session.cwd),
    project_path: session.cwd ?? null,
    title: session.title,
    last_message_preview: lastMessage?.text.trim().slice(0, 280) || null,
    status: session.status,
    model_id: session.modelId ?? null,
    started_at: session.startedAt ?? null,
    updated_at: lastMessage?.timestamp ?? new Date().toISOString(),
    attachment_count: attachments.length,
    attachments: [...uniqueAttachments.values()].slice(0, 25).map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      ...(attachment.path ? { path: attachment.path } : {}),
    })),
    usage: usage
      ? {
          input: usage.input,
          output: usage.output,
          cache_read: usage.cacheRead,
          cache_write: usage.cacheWrite,
          reasoning: usage.reasoning,
          total: usage.total,
          calls: usage.calls,
        }
      : null,
  };
};

const schedule = (session: Session): void => {
  if (!session.headTracked || (!session.piSessionId && session.messages.length === 0)) return;
  const metadata = sessionMetadata(session);
  const signature = JSON.stringify({ ...metadata, updated_at: "" });
  if (signatures.get(session.id) === signature) return;
  const existing = timers.get(session.id);
  if (existing) clearTimeout(existing);
  timers.set(
    session.id,
    setTimeout(() => {
      timers.delete(session.id);
      if (!getHeadConnection()) return;
      void createHeadApiClient()
        .upsertSessionMetadata(metadata)
        .then(() => signatures.set(session.id, signature))
        .catch(() => undefined);
    }, 750),
  );
};

export const syncHeadSessionMetadata = (sessions: SessionsMap): void => {
  if (typeof window === "undefined") return;
  for (const session of sessions.values()) schedule(session);
};
