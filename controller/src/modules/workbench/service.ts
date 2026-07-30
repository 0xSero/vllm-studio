import { createHash, createHmac, randomUUID } from "node:crypto";
import type {
  ScientificComputeLease,
  ScientificComputeLeaseIssue,
  ScientificDatasetAttachment,
  ScientificDatasetAttachmentIssue,
  ScientificExperimentReceipt,
  ScientificExperimentReceiptFinalize,
  ScientificNotebookSession,
  ScientificRayJobSubmission,
} from "@local-studio/contracts/scientific-workbench";
import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import { validateScientificRayJobSubmission } from "@local-studio/contracts/scientific-workbench";
import type { NotebookInteractionEvent } from "@local-studio/contracts/notebook-agent";
import { Effect, Schema } from "effect";
import { badRequest, serviceUnavailable } from "../../core/errors";
import type {
  ScientificFoundryInvocationEvidence,
  ScientificRayJobRecord,
  ScientificRayJobResource,
} from "./types";
import { providerModelsEndpoint } from "../../../../shared/agent/openai-endpoint";
import type { ProviderConfig } from "../../config/persisted-config";
import { scientificPrincipalScope } from "./enterprise-identity";
import { assembleFoundryReceiptEvidence } from "./receipt-foundry-evidence";
import {
  resolveProviderHeaders,
  type ProviderAuthenticationContext,
} from "../../services/provider-authentication";
import { assertProviderOutboundUrl } from "../../services/provider-boundary";

type ScientificNotebookState = ScientificNotebookSession["state"];

export type ScientificAdmissionContext = {
  computeLease: ScientificComputeLease | null;
  datasetAttachments: ReadonlyMap<string, ScientificDatasetAttachment>;
  modelCatalog: ReadonlyMap<string, ReadonlySet<string>>;
  now: string;
};

type ScientificCatalogFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => ReturnType<typeof fetch>;

const ProviderModelsSchema = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String })),
});

export const discoverScientificModelCatalog = (
  providers: readonly ProviderConfig[],
  fetcher: ScientificCatalogFetch = fetch,
  authenticationContext: ProviderAuthenticationContext = {},
): Effect.Effect<ReadonlyMap<string, ReadonlySet<string>>, unknown> =>
  Effect.forEach(
    providers.filter(({ enabled }) => enabled),
    (provider) =>
      Effect.gen(function* () {
        const authorization = yield* resolveProviderHeaders(provider, authenticationContext);
        const baseUrl =
          fetcher === fetch
            ? yield* assertProviderOutboundUrl(provider.base_url)
            : provider.base_url;
        const response = yield* Effect.tryPromise({
          try: (signal) =>
            fetcher(providerModelsEndpoint(baseUrl, provider.path_style, provider.api_version), {
              headers: {
                Accept: "application/json",
                ...authorization,
              },
              signal: authenticationContext.signal
                ? AbortSignal.any([
                    authenticationContext.signal,
                    signal,
                    AbortSignal.timeout(10_000),
                  ])
                : AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
              redirect: "error",
            }),
          catch: (error) => error,
        });
        if (!response.ok) {
          return yield* Effect.fail(
            serviceUnavailable(`Model catalog for "${provider.id}" returned ${response.status}`),
          );
        }
        const payload = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (error) => error,
        });
        const decoded = yield* Schema.decodeUnknownEffect(ProviderModelsSchema)(payload);
        return [provider.id, new Set(decoded.data.map(({ id }) => id))] as const;
      }),
    { concurrency: 4 },
  ).pipe(Effect.map((entries) => new Map(entries)));

const NOTEBOOK_TRANSITIONS: Record<ScientificNotebookState, ScientificNotebookState[]> = {
  requested: ["provisioning", "failed"],
  provisioning: ["ready", "failed"],
  ready: ["active", "suspended", "archived", "failed"],
  active: ["idle", "suspended", "archived", "failed"],
  idle: ["active", "suspended", "archived", "failed"],
  suspended: ["provisioning", "archived", "failed"],
  archived: [],
  failed: ["provisioning", "archived"],
};

const expiredAt = (value: string, now: string): boolean => {
  const expiry = Date.parse(value);
  const reference = Date.parse(now);
  return !Number.isFinite(expiry) || !Number.isFinite(reference) || expiry <= reference;
};

export const issueScientificComputeLease = (
  input: ScientificComputeLeaseIssue,
  notebook: ScientificNotebookSession,
  now: string,
): ScientificComputeLease => {
  if (
    notebook.id !== input.notebook_id ||
    notebook.project_id !== input.project_id ||
    notebook.classification !== input.classification ||
    notebook.compute_profile_id !== input.profile.id
  ) {
    throw badRequest("Compute lease request does not match the governed notebook");
  }
  if (!["ready", "active", "idle"].includes(notebook.state)) {
    throw badRequest("Compute lease requires an execution-ready notebook");
  }
  if (expiredAt(input.expires_at, now)) {
    throw badRequest("Compute lease expiry must be in the future");
  }
  return {
    id: randomUUID(),
    project_id: input.project_id,
    notebook_id: input.notebook_id,
    profile_id: input.profile.id,
    profile: input.profile,
    classification: input.classification,
    state: "admitted",
    requested_at: now,
    expires_at: input.expires_at,
  };
};

export const issueScientificDatasetAttachment = (
  input: ScientificDatasetAttachmentIssue,
  now: string,
): ScientificDatasetAttachment => {
  if (!input.purpose.trim()) {
    throw badRequest("Dataset attachment purpose is required");
  }
  if (!/^[a-z0-9]+:[a-f0-9]{32,}$/u.test(input.digest)) {
    throw badRequest("Dataset attachment digest must include an algorithm prefix");
  }
  if (expiredAt(input.lease_expires_at, now)) {
    throw badRequest("Dataset attachment expiry must be in the future");
  }
  return {
    attachment_id: randomUUID(),
    project_id: input.project_id,
    dataset_id: input.dataset_id,
    version: input.version,
    digest: input.digest,
    classification: input.classification,
    access: "read-only",
    purpose: input.purpose.trim(),
    issued_at: now,
    lease_expires_at: input.lease_expires_at,
  };
};

const dnsLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63);

const rayResources = (
  submission: ScientificRayJobSubmission,
): { requests: Record<string, string>; limits: Record<string, string> } => {
  const profile = submission.compute_profile;
  const values: Record<string, string> = {
    cpu: String(profile.cpu_cores),
    memory: `${profile.memory_gb}Gi`,
  };
  if (profile.gpu_count > 0 && profile.gpu_resource) {
    values[profile.gpu_resource] = String(profile.gpu_count);
  }
  return { requests: values, limits: values };
};

const rayEnvironment = (
  submission: ScientificRayJobSubmission,
  principal?: NormalizedPrincipal,
): Array<{ name: string; value: string }> => [
  { name: "LOCAL_STUDIO_CLASSIFICATION", value: submission.classification },
  {
    name: "LOCAL_STUDIO_DATASET_REFS",
    value: JSON.stringify(
      submission.datasets.map(({ dataset_id, version, digest }) => ({
        dataset_id,
        version,
        digest,
      })),
    ),
  },
  {
    name: "LOCAL_STUDIO_MODEL_REFS",
    value: JSON.stringify(submission.models.map(({ qualified_id }) => qualified_id)),
  },
  ...(principal
    ? [
        { name: "LOCAL_STUDIO_ENTERPRISE_SUBJECT", value: principal.subject },
        { name: "LOCAL_STUDIO_ENTERPRISE_ISSUER_ID", value: principal.issuer_id },
        { name: "LOCAL_STUDIO_ENTERPRISE_TENANT", value: principal.tenant },
        { name: "LOCAL_STUDIO_ENTERPRISE_CLEARANCE", value: principal.clearance },
      ]
    : []),
];

export const admitScientificRayJob = (
  submission: ScientificRayJobSubmission,
  notebook: ScientificNotebookSession | null,
  configuredProviderIds: ReadonlySet<string>,
  governance?: ScientificAdmissionContext,
): void => {
  const violations = validateScientificRayJobSubmission(submission);
  if (violations.length > 0) {
    throw badRequest(violations.map(({ field, reason }) => `${field} ${reason}`).join("; "));
  }
  if (!notebook) throw badRequest(`Notebook "${submission.notebook_id}" does not exist`);
  if (!["ready", "active", "idle"].includes(notebook.state)) {
    throw badRequest(`Notebook "${submission.notebook_id}" is not ready for job submission`);
  }
  if (notebook.project_id !== submission.project_id) {
    throw badRequest("Notebook and submission must belong to the same project");
  }
  if (notebook.classification !== submission.classification) {
    throw badRequest("Notebook and submission classification must match");
  }
  if (!governance) {
    throw badRequest("Scientific governance context is required");
  }
  const lease = governance.computeLease;
  if (!lease || lease.id !== submission.compute_lease_id) {
    throw badRequest("Controller-issued compute lease does not exist");
  }
  if (
    lease.project_id !== submission.project_id ||
    lease.notebook_id !== submission.notebook_id ||
    lease.profile_id !== submission.compute_profile.id ||
    JSON.stringify(lease.profile) !== JSON.stringify(submission.compute_profile) ||
    lease.classification !== submission.classification
  ) {
    throw badRequest("Compute lease does not match the governed submission");
  }
  if (!["admitted", "provisioning", "running"].includes(lease.state)) {
    throw badRequest(`Compute lease is not admitted: ${lease.state}`);
  }
  if (expiredAt(lease.expires_at, governance.now)) {
    throw badRequest("Compute lease has expired");
  }
  for (const dataset of submission.datasets) {
    const issued = governance.datasetAttachments.get(dataset.attachment_id);
    if (!issued || JSON.stringify(issued) !== JSON.stringify(dataset)) {
      throw badRequest(`Dataset attachment "${dataset.attachment_id}" is not controller-issued`);
    }
    if (
      dataset.project_id !== submission.project_id ||
      dataset.classification !== submission.classification ||
      dataset.access !== "read-only" ||
      !dataset.purpose.trim()
    ) {
      throw badRequest(`Dataset attachment "${dataset.attachment_id}" violates submission policy`);
    }
    if (expiredAt(dataset.lease_expires_at, governance.now)) {
      throw badRequest(`Dataset attachment "${dataset.attachment_id}" has expired`);
    }
  }
  for (const model of submission.models) {
    if (!configuredProviderIds.has(model.provider_id)) {
      throw badRequest(`Model provider "${model.provider_id}" is not configured`);
    }
    if (!governance.modelCatalog.get(model.provider_id)?.has(model.model_id)) {
      throw badRequest(
        `Model "${model.qualified_id}" is not present in the authoritative provider catalog`,
      );
    }
  }
};

export const transitionScientificNotebook = (
  notebook: ScientificNotebookSession,
  nextState: ScientificNotebookState,
  updatedAt: string,
): ScientificNotebookSession => {
  if (notebook.state === nextState) return notebook;
  if (!NOTEBOOK_TRANSITIONS[notebook.state].includes(nextState)) {
    throw badRequest(`Notebook cannot transition from ${notebook.state} to ${nextState}`);
  }
  return { ...notebook, state: nextState, updated_at: updatedAt };
};

export const generateScientificRayJobResource = (
  submission: ScientificRayJobSubmission,
  principal?: NormalizedPrincipal,
): ScientificRayJobResource => {
  const profile = submission.compute_profile;
  const resourceName = dnsLabel(`experiment-${submission.experiment_id}`);
  const namespace = dnsLabel(`workbench-${submission.project_id}`);
  const resources = rayResources(submission);
  const env = rayEnvironment(submission, principal);
  const container = {
    name: "ray" as const,
    image: submission.environment_image,
    resources,
    env,
  };
  return {
    apiVersion: "ray.io/v1",
    kind: "RayJob",
    metadata: {
      name: resourceName,
      namespace,
      labels: {
        "app.kubernetes.io/managed-by": "local-studio",
        "local-studio/classification": submission.classification,
        "local-studio/project": dnsLabel(submission.project_id),
      },
      annotations: {
        "local-studio/submission-id": submission.id,
        "local-studio/notebook-id": submission.notebook_id,
      },
    },
    spec: {
      entrypoint: submission.entrypoint,
      shutdownAfterJobFinishes: true,
      ttlSecondsAfterFinished: 3600,
      rayClusterSpec: {
        headGroupSpec: {
          rayStartParams: { "dashboard-host": "0.0.0.0" },
          template: {
            spec: { automountServiceAccountToken: false, containers: [container] },
          },
        },
        workerGroupSpecs: [
          {
            groupName: "workers",
            replicas: profile.min_workers,
            minReplicas: profile.min_workers,
            maxReplicas: profile.max_workers,
            rayStartParams: {},
            template: {
              spec: { automountServiceAccountToken: false, containers: [container] },
            },
          },
        ],
      },
    },
  };
};

export const createScientificRayJobRecord = (
  submission: ScientificRayJobSubmission,
  admittedAt: string,
  principal?: NormalizedPrincipal,
): ScientificRayJobRecord => ({
  id: submission.id,
  state: "queued",
  submission,
  ...(principal ? { admission_principal: scientificPrincipalScope(principal) } : {}),
  resource: generateScientificRayJobResource(submission, principal),
  admitted_at: admittedAt,
});

export const createScientificExperimentReceipt = (
  job: ScientificRayJobRecord,
  notebook: ScientificNotebookSession,
  notebookRevision: string,
  notebookInteractions: readonly NotebookInteractionEvent[],
  _finalization: ScientificExperimentReceiptFinalize,
  signingKey: string,
  principal?: NormalizedPrincipal,
  foundryEvidence: readonly ScientificFoundryInvocationEvidence[] = [],
): ScientificExperimentReceipt => {
  if (job.state !== "succeeded" && job.state !== "failed") {
    throw badRequest("Experiment receipt requires a terminal RayJob");
  }
  if (job.submission.notebook_id !== notebook.id) {
    throw badRequest("RayJob and notebook identity do not match");
  }
  const policyDecisionIds = job.cluster?.policy_decision_ids;
  const artifactDigests = job.cluster?.artifact_digests;
  const resourceUsage = job.cluster?.resource_usage;
  if (!policyDecisionIds || !artifactDigests || !resourceUsage) {
    throw badRequest("Experiment receipt requires controller-measured evidence");
  }
  if (policyDecisionIds.length === 0) {
    throw badRequest("Experiment receipt requires at least one policy decision");
  }
  if (
    resourceUsage.cpu_seconds < 0 ||
    resourceUsage.gpu_seconds < 0 ||
    resourceUsage.peak_memory_gb < 0
  ) {
    throw badRequest("Experiment receipt resource usage must not be negative");
  }
  if (artifactDigests.some((digest) => !/^[a-z0-9]+:[a-f0-9]{32,}$/u.test(digest))) {
    throw badRequest("Experiment receipt artifact digests must include an algorithm prefix");
  }
  const issuedAt = job.reconciled_at;
  if (!issuedAt) {
    throw badRequest("Experiment receipt requires reconciliation evidence");
  }
  if (signingKey.length < 32) {
    throw badRequest("Experiment receipt signing key is not configured");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(notebookRevision)) {
    throw badRequest("Experiment receipt requires a governed notebook revision");
  }
  if (
    notebookInteractions.some(
      (event) => event.notebook_id !== notebook.id || event.project_id !== notebook.project_id,
    )
  ) {
    throw badRequest("Experiment receipt notebook interactions are out of scope");
  }
  const notebookInteractionDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(notebookInteractions))
    .digest("hex")}`;
  const { receiptPrincipal, invocations, agents, correlationIds } =
    assembleFoundryReceiptEvidence(job, principal, foundryEvidence);
  const evidence = {
    submission_id: job.submission.id,
    ray_job_id:
      job.cluster?.uid ?? `${job.resource.metadata.namespace}/${job.resource.metadata.name}`,
    state: job.state,
    classification: job.submission.classification,
    notebook_digest: notebook.image_digest,
    notebook_revision: notebookRevision,
    notebook_interaction_digest: notebookInteractionDigest,
    notebook_interaction_count: notebookInteractions.length,
    environment_digest: job.submission.environment_digest,
    datasets: job.submission.datasets,
    models: job.submission.models,
    artifact_digests: [...artifactDigests],
    policy_decision_ids: [...policyDecisionIds],
    apim_correlation_ids: correlationIds,
    ...(receiptPrincipal ? { principal: receiptPrincipal } : {}),
    ...(agents.length > 0 ? { agents } : {}),
    ...(invocations.length > 0 ? { foundry_invocations: invocations } : {}),
    approval_ids: [...job.submission.approval_ids],
    resource_usage: resourceUsage,
    started_at: job.cluster?.started_at ?? job.submitted_at ?? job.admitted_at,
    completed_at: job.cluster?.ended_at ?? job.reconciled_at ?? null,
  };
  const receiptDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex")}`;
  return {
    id: `receipt-${job.id}`,
    receipt_digest: receiptDigest,
    receipt_signature: `hmac-sha256:${createHmac("sha256", signingKey)
      .update(receiptDigest)
      .digest("hex")}`,
    evidence_source: "controller-reconciled",
    ...evidence,
    issued_at: issuedAt,
  };
};
