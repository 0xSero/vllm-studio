import type { Project } from "@/features/agent/projects/types";
import type { Session } from "@/features/agent/runtime/types";

export type TerminalOwnerKind = "project" | "session";

export type TerminalOwner = {
  mountKey: string;
  matchKeys: string[];
  cwd: string | null;
  title: string;
  kind: TerminalOwnerKind;
  sessionId?: string | null;
  piSessionId?: string | null;
  projectId?: string | null;
};

export type TerminalOwnersState = {
  owners: TerminalOwner[];
  activeOwnerKey: string | null;
};

export function uniqueTerminalKeys(keys: string[]): string[] {
  return [...new Set(keys.filter(Boolean))];
}

export function terminalKeysMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.some((key) => b.includes(key));
}

export function mergeTerminalKeys(a: readonly string[], b: readonly string[]): string[] {
  return uniqueTerminalKeys([...a, ...b]);
}

export function terminalOwnerFor(
  project: Project | null,
  session: Session | null,
): TerminalOwner | null {
  if (session) {
    const mountKey = `session:${session.id}`;
    return {
      mountKey,
      matchKeys: uniqueTerminalKeys([
        mountKey,
        session.piSessionId ? `pi:${session.piSessionId}` : "",
      ]),
      cwd: session.cwd ?? project?.path ?? null,
      title: session.title?.trim() || project?.name || "Session terminal",
      kind: "session",
      sessionId: session.id,
      piSessionId: session.piSessionId ?? null,
      projectId: session.projectId ?? project?.id ?? null,
    };
  }
  if (!project) return null;
  const mountKey = `project:${project.id}`;
  return {
    mountKey,
    matchKeys: [mountKey],
    cwd: project.path,
    title: project.name || "Project terminal",
    kind: "project",
    projectId: project.id,
  };
}

export function terminalOwnerLabel(owner: TerminalOwner, index: number): string {
  const title = owner.title.trim();
  if (title) return title;
  return owner.kind === "project" ? "Project terminal" : `Terminal ${index + 1}`;
}

export const OPEN_TERMINAL_EVENT = "local-studio:open-terminal";

export type OpenTerminalEventDetail = { mountKey: string };
