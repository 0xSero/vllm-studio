import { createSessionScopedJsonStore } from "@local-studio/agent-runtime/session-json-store";
import { isRecord } from "@/lib/guards";

export type AgentCanvasDocument = {
  enabled: boolean;
  text: string;
  updatedAt: string;
};

const store = createSessionScopedJsonStore<AgentCanvasDocument>({
  subdir: "agent-canvas",
  legacyFile: "agent-canvas.json",
  normalize: (input) => {
    const value = isRecord(input) ? input : {};
    return {
      enabled: value.enabled === true,
      text: typeof value.text === "string" ? value.text : "",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
  },
});

export const readAgentCanvas = store.read;
export const writeAgentCanvas = store.write;
