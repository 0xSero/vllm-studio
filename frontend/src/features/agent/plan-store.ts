import { createSessionScopedJsonStore } from "@local-studio/agent-runtime/session-json-store";
import { isRecord } from "@/lib/guards";

// Per-session plan document. The Markdown is canonical (Cursor stores plans as
// editable files); todos are derived from it on the client via `plan-parser`.
export type AgentPlanDocument = {
  markdown: string;
  updatedAt: string;
};

const store = createSessionScopedJsonStore<AgentPlanDocument>({
  subdir: "agent-plan",
  legacyFile: "agent-plan.json",
  normalize: (input) => {
    const value = isRecord(input) ? input : {};
    return {
      markdown: typeof value.markdown === "string" ? value.markdown : "",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
  },
});

export const readAgentPlan = store.read;
export const writeAgentPlan = store.write;
