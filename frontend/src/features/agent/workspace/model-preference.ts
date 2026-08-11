import { readStored, writeStored } from "@/lib/storage";

export const DEFAULT_AGENT_MODEL_KEY = "local-studio.agent.defaultModel";

export function readDefaultAgentModel(storage: Pick<Storage, "getItem">): string {
  return readStored(DEFAULT_AGENT_MODEL_KEY, storage)?.trim() ?? "";
}

export function writeDefaultAgentModel(storage: Pick<Storage, "setItem">, modelId: string): void {
  writeStored(DEFAULT_AGENT_MODEL_KEY, modelId, storage);
}
