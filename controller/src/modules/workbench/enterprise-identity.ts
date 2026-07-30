import type {
  EnterprisePrincipalScope,
  NormalizedPrincipal,
} from "@local-studio/contracts/enterprise-auth";
import type {
  ScientificExperimentReceipt,
  ScientificNotebookSession,
} from "@local-studio/contracts/scientific-workbench";
import { forbidden, notFound } from "../../core/errors";
import type { ScientificRayJobRecord } from "./types";

const normalizedIssuer = (value: string): string => value.replace(/\/+$/u, "");

export const scientificPrincipalScope = (
  principal: NormalizedPrincipal,
): EnterprisePrincipalScope => ({
  subject: principal.subject,
  issuer: principal.issuer,
  issuer_id: principal.issuer_id,
  tenant: principal.tenant,
  clearance: principal.clearance,
});

const sameAuthorityDomain = (
  principal: NormalizedPrincipal,
  scope: EnterprisePrincipalScope,
): boolean =>
  normalizedIssuer(principal.issuer) === normalizedIssuer(scope.issuer) &&
  principal.issuer_id === scope.issuer_id &&
  principal.tenant === scope.tenant;

const canAccessScope = (principal: NormalizedPrincipal, scope: EnterprisePrincipalScope): boolean =>
  sameAuthorityDomain(principal, scope) &&
  (principal.subject === scope.subject || principal.roles.includes("platform_admin"));

export const canAccessScientificNotebook = (
  principal: NormalizedPrincipal | undefined,
  notebook: ScientificNotebookSession,
): boolean => {
  if (!principal) return true;
  if (notebook.owner_principal) return canAccessScope(principal, notebook.owner_principal);
  return principal.subject === notebook.owner_id;
};

export const canAccessScientificRayJob = (
  principal: NormalizedPrincipal | undefined,
  job: ScientificRayJobRecord,
): boolean => {
  if (!principal) return true;
  if (job.admission_principal) return canAccessScope(principal, job.admission_principal);
  return principal.subject === job.submission.requested_by;
};

export const canAccessScientificReceipt = (
  principal: NormalizedPrincipal | undefined,
  receipt: ScientificExperimentReceipt,
): boolean => {
  if (!principal) return true;
  if (!receipt.principal) return false;
  if (receipt.principal.issuer) {
    return canAccessScope(principal, {
      ...receipt.principal,
      issuer: receipt.principal.issuer,
    });
  }
  return (
    principal.issuer_id === receipt.principal.issuer_id &&
    principal.tenant === receipt.principal.tenant &&
    (principal.subject === receipt.principal.subject || principal.roles.includes("platform_admin"))
  );
};

export const scientificActorId = (
  principal: NormalizedPrincipal | undefined,
  assertedActorId: string | undefined,
): string => principal?.subject ?? assertedActorId?.trim() ?? "";

export const bindScientificNotebookOwner = (
  principal: NormalizedPrincipal | undefined,
  assertedOwnerId: string,
): string => {
  const ownerId = assertedOwnerId.trim();
  if (principal && ownerId && ownerId !== principal.subject) {
    throw forbidden("Notebook owner must match the authenticated enterprise subject");
  }
  return principal?.subject ?? ownerId;
};

export const requireScientificNotebookMutationOwner = (
  principal: NormalizedPrincipal | undefined,
  notebook: ScientificNotebookSession,
): ScientificNotebookSession => {
  if (!canAccessScientificNotebook(principal, notebook)) {
    throw notFound("Notebook not found");
  }
  return notebook;
};

export const requireScientificNotebookAccess = (
  principal: NormalizedPrincipal | undefined,
  notebook: ScientificNotebookSession,
): ScientificNotebookSession => {
  if (!canAccessScientificNotebook(principal, notebook)) {
    throw notFound("Notebook not found");
  }
  return notebook;
};

export const requireScientificRayJobAccess = (
  principal: NormalizedPrincipal | undefined,
  job: ScientificRayJobRecord,
): ScientificRayJobRecord => {
  if (!canAccessScientificRayJob(principal, job)) {
    throw notFound("RayJob not found");
  }
  return job;
};

export const requireScientificReceiptAccess = (
  principal: NormalizedPrincipal | undefined,
  receipt: ScientificExperimentReceipt,
): ScientificExperimentReceipt => {
  if (!canAccessScientificReceipt(principal, receipt)) {
    throw notFound("Experiment receipt not found");
  }
  return receipt;
};

export const requireScientificSubmissionOwner = (
  principal: NormalizedPrincipal | undefined,
  requestedBy: string,
): void => {
  if (principal && requestedBy.trim() !== principal.subject) {
    throw forbidden("Ray submission requester must match the authenticated enterprise subject");
  }
};

export const scientificNotebookIdentity = (
  notebook: ScientificNotebookSession,
): { notebook_id: string; project_id: string; actor_id: string } => ({
  notebook_id: notebook.id,
  project_id: notebook.project_id,
  actor_id: notebook.owner_id,
});
