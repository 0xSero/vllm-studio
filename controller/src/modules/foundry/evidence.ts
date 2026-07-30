import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import type { FoundryUsage } from "@local-studio/contracts/foundry";

type FoundryEvidence = {
  event: "catalog_observed" | "model_invocation" | "agent_invocation";
  principal: NormalizedPrincipal;
  operation: string;
  correlation_id: string;
  provider_id: string;
  resource_id?: string;
  status: number;
  usage?: FoundryUsage;
};

export const emitFoundryEvidence = (entry: FoundryEvidence): void => {
  const { principal, ...evidence } = entry;
  console.info(
    JSON.stringify({
      schema: "local-studio.foundry-evidence/v1",
      timestamp: new Date().toISOString(),
      ...evidence,
      subject: principal.subject,
      issuer: principal.issuer,
      issuer_id: principal.issuer_id,
      tenant: principal.tenant,
      clearance: principal.clearance,
    }),
  );
};
