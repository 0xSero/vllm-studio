import { Schema } from "effect";
import { ClearanceSchema, EnterprisePrincipalScopeSchema } from "./enterprise-auth";

export const SCIENTIFIC_NOTEBOOK_STATES = [
  "requested",
  "provisioning",
  "ready",
  "active",
  "idle",
  "suspended",
  "archived",
  "failed",
] as const;

export const SCIENTIFIC_COMPUTE_LEASE_STATES = [
  "requested",
  "admitted",
  "provisioning",
  "running",
  "draining",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

export const SCIENTIFIC_JOB_STATES = [
  "queued",
  "submitted",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export const ScientificClassificationSchema = Schema.Literal("C2");
export const ScientificNotebookRuntimeSchema = Schema.Literals([
  "python-jupyter",
  "python-smolvm",
  "node-smolvm",
]);

export const ScientificNotebookSessionSchema = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  owner_id: Schema.String,
  owner_principal: Schema.optional(EnterprisePrincipalScopeSchema),
  runtime: Schema.optional(ScientificNotebookRuntimeSchema),
  document_path: Schema.optional(Schema.String),
  state: Schema.Literals(SCIENTIFIC_NOTEBOOK_STATES),
  classification: ScientificClassificationSchema,
  compute_profile_id: Schema.String,
  image_digest: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  expires_at: Schema.String,
});

export const ScientificNotebookCreateSchema = Schema.Struct({
  project_id: Schema.String,
  owner_id: Schema.String,
  runtime: ScientificNotebookRuntimeSchema,
  document_path: Schema.String,
  classification: ScientificClassificationSchema,
  compute_profile_id: Schema.String,
  image_digest: Schema.String,
  expires_at: Schema.String,
});

export const ScientificNotebookStateUpdateSchema = Schema.Struct({
  state: Schema.Literals(SCIENTIFIC_NOTEBOOK_STATES),
});

export const ScientificComputeProfileSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  cpu_cores: Schema.Number,
  memory_gb: Schema.Number,
  gpu_count: Schema.Number,
  gpu_resource: Schema.NullOr(Schema.String),
  min_workers: Schema.Number,
  max_workers: Schema.Number,
  max_runtime_minutes: Schema.Number,
  idle_timeout_minutes: Schema.Number,
  network_policy: Schema.Literal("deny-by-default"),
  classification_ceiling: ScientificClassificationSchema,
});

export const ScientificComputeLeaseSchema = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  notebook_id: Schema.String,
  profile_id: Schema.String,
  profile: ScientificComputeProfileSchema,
  classification: ScientificClassificationSchema,
  state: Schema.Literals(SCIENTIFIC_COMPUTE_LEASE_STATES),
  requested_at: Schema.String,
  expires_at: Schema.String,
});

export const ScientificComputeLeaseIssueSchema = Schema.Struct({
  project_id: Schema.String,
  notebook_id: Schema.String,
  profile: ScientificComputeProfileSchema,
  classification: ScientificClassificationSchema,
  expires_at: Schema.String,
});

export const ScientificDatasetAttachmentSchema = Schema.Struct({
  attachment_id: Schema.String,
  project_id: Schema.String,
  dataset_id: Schema.String,
  version: Schema.String,
  digest: Schema.String,
  classification: ScientificClassificationSchema,
  access: Schema.Literal("read-only"),
  purpose: Schema.String,
  issued_at: Schema.String,
  lease_expires_at: Schema.String,
});

export const ScientificDatasetAttachmentIssueSchema = Schema.Struct({
  project_id: Schema.String,
  dataset_id: Schema.String,
  version: Schema.String,
  digest: Schema.String,
  classification: ScientificClassificationSchema,
  purpose: Schema.String,
  lease_expires_at: Schema.String,
});

export const ScientificModelReferenceSchema = Schema.Struct({
  provider_id: Schema.String,
  model_id: Schema.String,
  qualified_id: Schema.String,
  endpoint_class: Schema.Literal("openai-compatible"),
  tool_mode: Schema.Literals(["none", "approved"]),
});

export const ScientificRayJobSubmissionSchema = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  notebook_id: Schema.String,
  compute_lease_id: Schema.String,
  experiment_id: Schema.String,
  classification: ScientificClassificationSchema,
  compute_profile: ScientificComputeProfileSchema,
  environment_image: Schema.String,
  environment_digest: Schema.String,
  entrypoint: Schema.String,
  datasets: Schema.Array(ScientificDatasetAttachmentSchema),
  models: Schema.Array(ScientificModelReferenceSchema),
  parameters: Schema.Record(Schema.String, Schema.Unknown),
  random_seeds: Schema.Array(Schema.Number),
  approval_ids: Schema.Array(Schema.String),
  requested_by: Schema.String,
  requested_at: Schema.String,
});

export const ScientificResourceUsageSchema = Schema.Struct({
  cpu_seconds: Schema.Number,
  gpu_seconds: Schema.Number,
  peak_memory_gb: Schema.Number,
});

export const ScientificExperimentReceiptFinalizeSchema = Schema.Struct({
  artifact_digests: Schema.Array(Schema.String),
  policy_decision_ids: Schema.Array(Schema.String),
  resource_usage: ScientificResourceUsageSchema,
});

export const ScientificExperimentReceiptSchema = Schema.Struct({
  id: Schema.String,
  receipt_digest: Schema.String,
  receipt_signature: Schema.String,
  evidence_source: Schema.Literal("controller-reconciled"),
  submission_id: Schema.String,
  ray_job_id: Schema.String,
  state: Schema.Literals(SCIENTIFIC_JOB_STATES),
  classification: ScientificClassificationSchema,
  notebook_digest: Schema.String,
  notebook_revision: Schema.String,
  notebook_interaction_digest: Schema.String,
  notebook_interaction_count: Schema.Number,
  environment_digest: Schema.String,
  datasets: Schema.Array(ScientificDatasetAttachmentSchema),
  models: Schema.Array(ScientificModelReferenceSchema),
  artifact_digests: Schema.Array(Schema.String),
  policy_decision_ids: Schema.Array(Schema.String),
  apim_correlation_ids: Schema.optional(Schema.Array(Schema.String)),
  principal: Schema.optional(
    Schema.Struct({
      subject: Schema.String,
      issuer: Schema.optional(Schema.String),
      issuer_id: Schema.String,
      tenant: Schema.String,
      clearance: ClearanceSchema,
    }),
  ),
  agents: Schema.optional(
    Schema.Array(
      Schema.Struct({
        provider_id: Schema.optional(Schema.String),
        agent_id: Schema.String,
      }),
    ),
  ),
  foundry_invocations: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(["model", "agent"]),
        provider_id: Schema.String,
        resource_id: Schema.String,
        correlation_id: Schema.String,
        principal: EnterprisePrincipalScopeSchema,
      }),
    ),
  ),
  approval_ids: Schema.Array(Schema.String),
  resource_usage: ScientificResourceUsageSchema,
  started_at: Schema.String,
  completed_at: Schema.NullOr(Schema.String),
  issued_at: Schema.String,
});

export type ScientificNotebookSession = Schema.Schema.Type<typeof ScientificNotebookSessionSchema>;
export type ScientificNotebookRuntime = Schema.Schema.Type<typeof ScientificNotebookRuntimeSchema>;
export type ScientificNotebookCreate = Schema.Schema.Type<typeof ScientificNotebookCreateSchema>;
export type ScientificComputeProfile = Schema.Schema.Type<typeof ScientificComputeProfileSchema>;
export type ScientificComputeLease = Schema.Schema.Type<typeof ScientificComputeLeaseSchema>;
export type ScientificComputeLeaseIssue = Schema.Schema.Type<
  typeof ScientificComputeLeaseIssueSchema
>;
export type ScientificDatasetAttachment = Schema.Schema.Type<
  typeof ScientificDatasetAttachmentSchema
>;
export type ScientificDatasetAttachmentIssue = Schema.Schema.Type<
  typeof ScientificDatasetAttachmentIssueSchema
>;
export type ScientificModelReference = Schema.Schema.Type<typeof ScientificModelReferenceSchema>;
export type ScientificRayJobSubmission = Schema.Schema.Type<
  typeof ScientificRayJobSubmissionSchema
>;
export type ScientificExperimentReceipt = Schema.Schema.Type<
  typeof ScientificExperimentReceiptSchema
>;
export type ScientificExperimentReceiptFinalize = Schema.Schema.Type<
  typeof ScientificExperimentReceiptFinalizeSchema
>;

export type ScientificContractViolation = {
  field: string;
  reason: string;
};

const hasDigestPrefix = (value: string): boolean => /^[a-z0-9]+:[a-f0-9]{32,}$/u.test(value);

export const validateScientificRayJobSubmission = (
  submission: ScientificRayJobSubmission,
): ScientificContractViolation[] => {
  const violations: ScientificContractViolation[] = [];
  const profile = submission.compute_profile;

  if (profile.cpu_cores <= 0) {
    violations.push({ field: "compute_profile.cpu_cores", reason: "must be positive" });
  }
  if (profile.memory_gb <= 0) {
    violations.push({ field: "compute_profile.memory_gb", reason: "must be positive" });
  }
  if (profile.gpu_count < 0) {
    violations.push({ field: "compute_profile.gpu_count", reason: "must not be negative" });
  }
  if (profile.min_workers < 0 || profile.max_workers < profile.min_workers) {
    violations.push({
      field: "compute_profile.max_workers",
      reason: "must be greater than or equal to min_workers",
    });
  }
  if (profile.max_runtime_minutes <= 0 || profile.idle_timeout_minutes <= 0) {
    violations.push({
      field: "compute_profile",
      reason: "runtime and idle timeouts must be positive",
    });
  }
  if (!hasDigestPrefix(submission.environment_digest)) {
    violations.push({
      field: "environment_digest",
      reason: "must include an algorithm-prefixed digest",
    });
  }
  if (!submission.compute_lease_id.trim()) {
    violations.push({ field: "compute_lease_id", reason: "is required" });
  }
  if (!/^[^@\s]+@sha256:[a-f0-9]{64}$/u.test(submission.environment_image)) {
    violations.push({
      field: "environment_image",
      reason: "must be an OCI image reference pinned by sha256 digest",
    });
  }

  submission.datasets.forEach((dataset, index) => {
    if (!dataset.attachment_id.trim() || !dataset.project_id.trim()) {
      violations.push({
        field: `datasets.${index}`,
        reason: "requires controller-issued attachment and project identity",
      });
    }
    if (!hasDigestPrefix(dataset.digest)) {
      violations.push({
        field: `datasets.${index}.digest`,
        reason: "must include an algorithm-prefixed digest",
      });
    }
  });

  submission.models.forEach((model, index) => {
    if (model.qualified_id !== `${model.provider_id}/${model.model_id}`) {
      violations.push({
        field: `models.${index}.qualified_id`,
        reason: "must equal provider_id/model_id",
      });
    }
  });

  if (submission.approval_ids.length === 0) {
    violations.push({ field: "approval_ids", reason: "requires at least one approval" });
  }

  return violations;
};
