import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import type { ScientificExperimentReceipt } from "@local-studio/contracts/scientific-workbench";
import { badRequest } from "../../core/errors";
import { scientificPrincipalScope } from "./enterprise-identity";
import type {
  ScientificFoundryInvocationEvidence,
  ScientificRayJobRecord,
} from "./types";

const assertFoundryEvidence = (
  job: ScientificRayJobRecord,
  receiptPrincipal: ScientificExperimentReceipt["principal"],
  evidence: readonly ScientificFoundryInvocationEvidence[],
): void => {
  if (evidence.some(({ submission_id }) => submission_id !== job.submission.id)) {
    throw badRequest("Foundry evidence does not match the RayJob submission");
  }
  if (
    evidence.some(
      ({ correlation_id, provider_id, resource_id }) =>
        !/^[A-Za-z0-9._:-]{1,256}$/u.test(correlation_id) ||
        !provider_id.trim() ||
        !resource_id.trim(),
    )
  ) {
    throw badRequest("Foundry evidence identity is invalid");
  }
  if (
    receiptPrincipal &&
    evidence.some(
      ({ principal }) =>
        principal.issuer.replace(/\/+$/u, "") !== receiptPrincipal.issuer?.replace(/\/+$/u, "") ||
        principal.issuer_id !== receiptPrincipal.issuer_id ||
        principal.tenant !== receiptPrincipal.tenant,
    )
  ) {
    throw badRequest("Foundry evidence leaves the experiment authority domain");
  }
};

const receiptAgents = (
  job: ScientificRayJobRecord,
  invocations: NonNullable<ScientificExperimentReceipt["foundry_invocations"]>,
): NonNullable<ScientificExperimentReceipt["agents"]> => {
  const clusterAgents = (job.cluster?.agent_ids ?? []).map((qualifiedId) => {
    const separator = qualifiedId.indexOf("/");
    return separator > 0
      ? {
          provider_id: qualifiedId.slice(0, separator),
          agent_id: qualifiedId.slice(separator + 1),
        }
      : { agent_id: qualifiedId };
  });
  const invokedAgents = invocations
    .filter(({ kind }) => kind === "agent")
    .map(({ provider_id, resource_id }) => ({ provider_id, agent_id: resource_id }));
  return [
    ...new Map(
      [...clusterAgents, ...invokedAgents].map((agent) => [
        `${agent.provider_id ?? ""}/${agent.agent_id}`,
        agent,
      ]),
    ).values(),
  ];
};

export const assembleFoundryReceiptEvidence = (
  job: ScientificRayJobRecord,
  principal: NormalizedPrincipal | undefined,
  evidence: readonly ScientificFoundryInvocationEvidence[],
): {
  receiptPrincipal: ScientificExperimentReceipt["principal"];
  invocations: NonNullable<ScientificExperimentReceipt["foundry_invocations"]>;
  agents: NonNullable<ScientificExperimentReceipt["agents"]>;
  correlationIds: string[];
} => {
  const receiptPrincipal =
    job.admission_principal ?? (principal ? scientificPrincipalScope(principal) : undefined);
  assertFoundryEvidence(job, receiptPrincipal, evidence);
  const invocations = evidence.map(
    ({ kind, provider_id, resource_id, correlation_id, principal: invocationPrincipal }) => ({
      kind,
      provider_id,
      resource_id,
      correlation_id,
      principal: invocationPrincipal,
    }),
  );
  const agents = receiptAgents(job, invocations);
  const correlationIds = [
    ...new Set([
      ...(job.cluster?.apim_correlation_ids ?? []),
      ...invocations.map(({ correlation_id }) => correlation_id),
    ]),
  ];
  return { receiptPrincipal, invocations, agents, correlationIds };
};
