import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";

type ControllerEnterpriseAuditEvent = {
  event:
    | "authorization_denied"
    | "model_invocation"
    | "agent_invocation"
    | "notebook_mutation"
    | "ray_admission";
  principal?: NormalizedPrincipal;
  operation: string;
  correlation_id?: string;
  resource_id?: string;
  reason?: string;
};

export const emitControllerEnterpriseAudit = (entry: ControllerEnterpriseAuditEvent): void => {
  const { principal, ...event } = entry;
  console.info(
    JSON.stringify({
      schema: "local-studio.enterprise-audit/v1",
      timestamp: new Date().toISOString(),
      ...event,
      ...(principal
        ? {
            subject: principal.subject,
            issuer_id: principal.issuer_id,
            tenant: principal.tenant,
            clearance: principal.clearance,
          }
        : {}),
    }),
  );
};
