import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const getAgentDirectory = (): string =>
  process.env["PI_CODING_AGENT_DIR"]?.trim() || join(homedir(), ".pi", "agent");

export { getAgentDirectory as getAgentDir };

export const readStoredCredential = (
  providerId: string,
  authPath = join(getAgentDirectory(), "auth.json"),
): unknown => {
  try {
    const stored = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
    return stored[providerId];
  } catch {
    return undefined;
  }
};
