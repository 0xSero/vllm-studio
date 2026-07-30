import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";

export const emitEnterpriseAgentEvidence = (
  principal: NormalizedPrincipal,
  input: {
    operation: string;
    session_id: string;
    model_id: string;
  },
): void => {
  console.info(
    JSON.stringify({
      schema: "local-studio.agent-enterprise-evidence/v1",
      timestamp: new Date().toISOString(),
      ...input,
      subject: principal.subject,
      issuer: principal.issuer,
      issuer_id: principal.issuer_id,
      tenant: principal.tenant,
      clearance: principal.clearance,
    }),
  );
};
