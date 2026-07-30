import type {
  Clearance,
  EnterpriseEntitlement,
  EnterpriseRole,
  NormalizedPrincipal,
} from "./enterprise-auth";

export type EnterpriseOperationPolicy = {
  entitlement: EnterpriseEntitlement;
  clearance?: Clearance;
  role?: EnterpriseRole;
};

const CONFIGURATION_PREFIXES = [
  "/api/agent/access-fabric",
  "/api/agent/accounts",
  "/api/agent/connectors",
  "/api/agent/lifecycle",
  "/api/agent/onboarding",
  "/api/agent/plugins",
  "/api/agent/providers",
  "/api/agent/provisioning",
  "/api/agent/setup-checks",
  "/api/provisioning",
  "/api/bootstrap",
  "/api/local-agents",
  "/api/settings",
  "/api/setup",
] as const;

const C2_CONFIGURATION_PREFIXES = [
  "/api/agent/access-fabric",
  "/api/agent/lifecycle",
  "/api/agent/onboarding",
  "/api/agent/provisioning",
  "/api/provisioning",
] as const;

export const enterpriseOperationPolicy = (
  method: string,
  path: string,
): EnterpriseOperationPolicy | null => {
  const pathname = path.split("?")[0] ?? path;
  const controllerPath = pathname.startsWith("/api/proxy/")
    ? pathname.slice("/api/proxy".length)
    : pathname;
  if (
    pathname === "/health" ||
    pathname === "/api/health" ||
    pathname === "/api/desktop-health" ||
    pathname.startsWith("/api/auth/")
  ) {
    return null;
  }
  if (C2_CONFIGURATION_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return { entitlement: "configuration:write", clearance: "C2" };
  }
  if (CONFIGURATION_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return { entitlement: "configuration:write" };
  }
  if (pathname.startsWith("/api/agent/models")) {
    return { entitlement: "model:invoke" };
  }
  if (pathname.startsWith("/api/agent/") || pathname.startsWith("/api/litter-bridge/")) {
    return { entitlement: "agent:invoke" };
  }
  if (pathname.startsWith("/api/huggingface/")) {
    return { entitlement: "model:invoke" };
  }
  if (controllerPath.startsWith("/workbench/")) {
    if (controllerPath.includes("/ray-jobs") || controllerPath.includes("/compute-leases")) {
      return { entitlement: "ray:admit", clearance: "C2", role: "scientist" };
    }
    return {
      entitlement: method.toUpperCase() === "GET" ? "notebook:read" : "notebook:execute",
    };
  }
  if (
    controllerPath.startsWith("/environment/") ||
    controllerPath.startsWith("/studio/providers")
  ) {
    return { entitlement: "configuration:write" };
  }
  if (controllerPath.startsWith("/ai/v1/agents")) {
    return { entitlement: "agent:invoke" };
  }
  if (
    controllerPath.startsWith("/ai/v1/") ||
    controllerPath.startsWith("/v1/chat/") ||
    controllerPath.startsWith("/v1/completions") ||
    controllerPath.startsWith("/v1/responses")
  ) {
    return { entitlement: "model:invoke" };
  }
  if (pathname.startsWith("/api/proxy/") && method.toUpperCase() !== "GET") {
    return { entitlement: "configuration:write" };
  }
  return null;
};

export const enterpriseOperationDenial = (
  principal: NormalizedPrincipal,
  policy: EnterpriseOperationPolicy,
): "entitlement" | "clearance" | "role" | null => {
  if (!principal.entitlements.includes(policy.entitlement)) return "entitlement";
  if (policy.clearance && principal.clearance !== policy.clearance) return "clearance";
  if (policy.role && !principal.roles.includes(policy.role)) return "role";
  return null;
};
