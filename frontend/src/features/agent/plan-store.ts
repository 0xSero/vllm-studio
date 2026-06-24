import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";

// Per-session plan document. The Markdown is canonical (Cursor stores plans as
// editable files); todos are derived from it on the client via `plan-parser`.
export type AgentPlanDocument = {
  markdown: string;
  updatedAt: string;
};

const DEFAULT_PLAN: AgentPlanDocument = {
  markdown: "",
  updatedAt: "",
};

function legacyPlanFilePath(): string {
  return path.join(resolveDataDir(), "agent-plan.json");
}

function sanitizeSessionId(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(trimmed)) return null;
  return trimmed;
}

function planFilePath(sessionId: string | null | undefined): string {
  const id = sanitizeSessionId(sessionId);
  if (!id) return legacyPlanFilePath();
  return path.join(resolveDataDir(), "agent-plan", `${id}.json`);
}

function normalizePlan(input: unknown): AgentPlanDocument {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    markdown: typeof value.markdown === "string" ? value.markdown : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export async function readAgentPlan(sessionId?: string | null): Promise<AgentPlanDocument> {
  try {
    return normalizePlan(JSON.parse(await readFile(planFilePath(sessionId), "utf8")));
  } catch {
    return DEFAULT_PLAN;
  }
}

export async function writeAgentPlan(
  patch: Partial<Pick<AgentPlanDocument, "markdown">>,
  sessionId?: string | null,
): Promise<AgentPlanDocument> {
  const current = await readAgentPlan(sessionId);
  const next: AgentPlanDocument = {
    ...current,
    ...(typeof patch.markdown === "string" ? { markdown: patch.markdown } : {}),
    updatedAt: new Date().toISOString(),
  };
  const filePath = planFilePath(sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
