import { Schema } from "effect";

export const AGENT_HARNESSES = ["claude", "codex", "fx", "opencode", "pi"] as const;
export const AgentHarnessSchema = Schema.Literals(AGENT_HARNESSES);
export type AgentHarness = (typeof AGENT_HARNESSES)[number];
