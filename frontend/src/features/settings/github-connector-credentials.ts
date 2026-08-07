import type { ConnectorView } from "@local-studio/agent-runtime/connector-contract";

export const GITHUB_TOKEN_KEY = "GITHUB_PERSONAL_ACCESS_TOKEN";
const MASKED_SECRET = "••••••••";

export function githubCredentialUpdate(token: string) {
  const normalized = token.trim();
  if (!normalized || normalized === MASKED_SECRET) {
    throw new Error("Enter a new personal access token");
  }
  return {
    id: "github" as const,
    catalogId: "github" as const,
    env: { [GITHUB_TOKEN_KEY]: normalized },
    enabled: true,
  };
}

export function hasStoredGitHubCredential(
  connector: Pick<ConnectorView, "secret_keys"> | null,
): boolean {
  return connector?.secret_keys.includes(GITHUB_TOKEN_KEY) ?? false;
}
