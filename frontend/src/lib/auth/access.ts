export const STUDIO_TOKEN_HEADER = "x-local-studio-token";
export const STUDIO_TOKEN_COOKIE = "local_studio_token";

export type AccessDecision =
  | { kind: "allow"; reason: "desktop" | "development" }
  | { kind: "require-token"; token: string }
  | { kind: "optional-oidc" }
  | { kind: "require-oidc" }
  | { kind: "misconfigured" };

export type AccessPostureInput = {
  enterpriseMode?: "local" | "optional_oidc" | "required_oidc" | null;
  enterpriseConfigPath?: string;
  desktop?: string;
  nodeEnv?: string;
  frontendToken?: string;
};

function trimmedEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function resolveAccessPosture(input: AccessPostureInput = {}): AccessDecision {
  const enterpriseMode = input.enterpriseMode;
  if (enterpriseMode === "required_oidc") return { kind: "require-oidc" };
  if (enterpriseMode === "optional_oidc") return { kind: "optional-oidc" };
  const enterpriseConfigPath =
    input.enterpriseConfigPath ?? trimmedEnv("LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG");
  if (enterpriseMode !== "local" && enterpriseConfigPath) return { kind: "require-oidc" };
  const desktop = input.desktop ?? trimmedEnv("LOCAL_STUDIO_DESKTOP");
  if (desktop === "1" || desktop === "true") return { kind: "allow", reason: "desktop" };
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv !== "production") return { kind: "allow", reason: "development" };
  return { kind: "misconfigured" };
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function presentedToken(
  headerToken: string | null,
  cookieToken: string | null | undefined,
): string {
  return (headerToken ?? cookieToken ?? "").trim();
}
