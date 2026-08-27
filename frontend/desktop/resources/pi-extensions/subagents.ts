import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Schema } from "effect";
import { requestJson, result } from "./first-party-tool.ts";

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const RUN_TIMEOUT_MS = 15 * 60_000;
const MANAGE_TIMEOUT_MS = 30_000;

type SubagentDetails =
  | { failed: true; name?: string }
  | { count: number }
  | { runId: string; status?: string }
  | { name?: string; piSessionId: string | null };

const SubagentResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.String),
  piSessionId: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.String),
});

const SubagentRunSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  active: Schema.optional(Schema.Boolean),
  piSessionId: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.optional(Schema.String),
  finishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  report: Schema.optional(Schema.String),
});
const SubagentListSchema = Schema.Struct({ subagents: Schema.Array(SubagentRunSchema) });
const SubagentDetailSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  subagent: SubagentRunSchema,
});
const ManagementResponseSchema = Schema.Union([SubagentListSchema, SubagentDetailSchema]);
type ManagementResponse = typeof ManagementResponseSchema.Type;

function formatRun(run: typeof SubagentRunSchema.Type): string {
  const state = run.status === "running" && run.active === false ? "idle" : run.status;
  const detail = run.error ? ` — ${run.error}` : "";
  return `- ${run.id} ${run.name} [${state}]${detail}`;
}

async function managementRequest(
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; status: number; body: ManagementResponse | null }> {
  const response = await requestJson(`${FRONTEND_BASE}${path}`, init, signal, MANAGE_TIMEOUT_MS);
  const parsed = Schema.decodeUnknownOption(ManagementResponseSchema)(response.body);
  return {
    ok: response.ok,
    status: response.status,
    body: parsed._tag === "Some" ? parsed.value : null,
  };
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  let sessionId: string | null = null;
  pi.on("session_start", (_event, ctx) => {
    try {
      sessionId = ctx.sessionManager.getSessionId();
    } catch {
      sessionId = null;
    }
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate a self-contained task to an independent subagent with its own fresh context. " +
      "Use for parallelizable research, reviews, or implementation chunks — call this tool " +
      "multiple times in one turn to fan out. Give each subagent a short name and a complete, " +
      "standalone task description; it cannot see this conversation. Returns the subagent's " +
      "final report.",
    parameters: Type.Object({
      name: Type.String({ description: "Short display name, e.g. 'API auditor'" }),
      task: Type.String({ description: "Complete standalone task instructions" }),
    }),
    async execute(_id, params, signal) {
      const args = params;
      if (!sessionId) {
        return result<SubagentDetails>("Subagents are unavailable: the session id is unknown.", {
          failed: true,
        });
      }
      try {
        const response = await requestJson(
          `${FRONTEND_BASE}/api/agent/subagents`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              parentPiSessionId: sessionId,
              name: args.name ?? "Subagent",
              task: args.task ?? "",
            }),
          },
          signal,
          RUN_TIMEOUT_MS,
        );
        const payload = Schema.decodeUnknownSync(SubagentResponseSchema)(response.body);
        if (!response.ok || !payload.ok) {
          return result<SubagentDetails>(`Subagent failed: ${payload.error ?? response.status}`, {
            failed: true,
            name: args.name,
          });
        }
        return result<SubagentDetails>(payload.result ?? "(no report)", {
          name: args.name,
          piSessionId: payload.piSessionId ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<SubagentDetails>(`Subagent failed: ${message}`, {
          failed: true,
          name: args.name,
        });
      }
    },
  });

  pi.registerTool({
    name: "subagent_list",
    label: "List subagents",
    description: "List every child spawned by this session and its live status.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      if (!sessionId)
        return result<SubagentDetails>("The session id is unknown.", { failed: true });
      try {
        const response = await managementRequest(
          `/api/agent/subagents?piSessionId=${encodeURIComponent(sessionId)}`,
          { method: "GET" },
          signal,
        );
        const parsed = Schema.decodeUnknownOption(SubagentListSchema)(response.body);
        if (!response.ok || parsed._tag === "None") {
          return result<SubagentDetails>(`Could not list subagents: HTTP ${response.status}`, {
            failed: true,
          });
        }
        const runs = parsed.value.subagents;
        return result<SubagentDetails>(
          runs.length ? runs.map(formatRun).join("\n") : "No subagents.",
          {
            count: runs.length,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<SubagentDetails>(`Could not list subagents: ${message}`, { failed: true });
      }
    },
  });

  pi.registerTool({
    name: "subagent_status",
    label: "Subagent status",
    description: "Read one child agent's live status and final report.",
    parameters: Type.Object({ runId: Type.String({ description: "Subagent run id." }) }),
    async execute(_id, params, signal) {
      if (!sessionId)
        return result<SubagentDetails>("The session id is unknown.", { failed: true });
      const runId = params.runId.trim();
      try {
        const response = await managementRequest(
          `/api/agent/subagents/${encodeURIComponent(runId)}?piSessionId=${encodeURIComponent(sessionId)}`,
          { method: "GET" },
          signal,
        );
        const parsed = Schema.decodeUnknownOption(SubagentDetailSchema)(response.body);
        if (!response.ok || parsed._tag === "None") {
          return result<SubagentDetails>(`Could not read subagent: HTTP ${response.status}`, {
            failed: true,
          });
        }
        const run = parsed.value.subagent;
        return result<SubagentDetails>(
          `${formatRun(run)}${run.report ? `\n\n${run.report}` : ""}`,
          {
            runId,
            status: run.status,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<SubagentDetails>(`Could not read subagent: ${message}`, { failed: true });
      }
    },
  });

  pi.registerTool({
    name: "subagent_stop",
    label: "Stop subagent",
    description: "Stop a child agent spawned by this session.",
    parameters: Type.Object({ runId: Type.String({ description: "Subagent run id." }) }),
    async execute(_id, params, signal) {
      if (!sessionId)
        return result<SubagentDetails>("The session id is unknown.", { failed: true });
      const runId = params.runId.trim();
      try {
        const response = await managementRequest(
          `/api/agent/subagents/${encodeURIComponent(runId)}/stop`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ piSessionId: sessionId }),
          },
          signal,
        );
        const parsed = Schema.decodeUnknownOption(SubagentDetailSchema)(response.body);
        if (!response.ok || parsed._tag === "None") {
          return result<SubagentDetails>(`Could not stop subagent: HTTP ${response.status}`, {
            failed: true,
          });
        }
        return result<SubagentDetails>(`Stopped subagent ${runId}.`, {
          runId,
          status: parsed.value.subagent.status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result<SubagentDetails>(`Could not stop subagent: ${message}`, { failed: true });
      }
    },
  });
}
