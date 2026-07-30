import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  ScientificNotebookCreateSchema,
  ScientificNotebookSessionSchema,
  ScientificRayJobSubmissionSchema,
  validateScientificRayJobSubmission,
  type ScientificRayJobSubmission,
} from "../contracts/scientific-workbench";

const submission = (): ScientificRayJobSubmission => ({
  id: "submission-01",
  project_id: "project-01",
  notebook_id: "notebook-01",
  compute_lease_id: "lease-01",
  experiment_id: "experiment-01",
  classification: "C2",
  compute_profile: {
    id: "gpu-small",
    name: "GPU small",
    cpu_cores: 8,
    memory_gb: 32,
    gpu_count: 1,
    gpu_resource: "nvidia.com/gpu",
    min_workers: 0,
    max_workers: 4,
    max_runtime_minutes: 240,
    idle_timeout_minutes: 30,
    network_policy: "deny-by-default",
    classification_ceiling: "C2",
  },
  environment_image: `registry.internal/workbench/science@sha256:${"c".repeat(64)}`,
  environment_digest: `sha256:${"a".repeat(64)}`,
  entrypoint: "python train.py",
  datasets: [
    {
      attachment_id: "attachment-01",
      project_id: "project-01",
      dataset_id: "dataset-01",
      version: "2026-07-27",
      digest: `sha256:${"b".repeat(64)}`,
      classification: "C2",
      access: "read-only",
      purpose: "model evaluation",
      issued_at: "2026-07-27T15:59:00Z",
      lease_expires_at: "2026-07-28T00:00:00Z",
    },
  ],
  models: [
    {
      provider_id: "tensorprime",
      model_id: "Qwen3-30B-A3B-Instruct-2507-NVFP4",
      qualified_id: "tensorprime/Qwen3-30B-A3B-Instruct-2507-NVFP4",
      endpoint_class: "openai-compatible",
      tool_mode: "none",
    },
  ],
  parameters: { temperature: 0 },
  random_seeds: [42],
  approval_ids: ["approval-01"],
  requested_by: "scientist-01",
  requested_at: "2026-07-27T16:00:00Z",
});

describe("scientific workbench contracts", () => {
  test("requires runtime and document identity for new notebook sessions", () => {
    const decoded = Schema.decodeUnknownSync(ScientificNotebookCreateSchema)({
      project_id: "project-01",
      owner_id: "scientist-01",
      runtime: "node-smolvm",
      document_path: "agent-collaboration-node.ipynb",
      classification: "C2",
      compute_profile_id: "gpu-small",
      image_digest: `sha256:${"d".repeat(64)}`,
      expires_at: "2026-07-28T16:00:00Z",
    });

    expect(decoded.runtime).toBe("node-smolvm");
    expect(decoded.document_path).toBe("agent-collaboration-node.ipynb");
  });

  test("accepts Python SmolVM as an explicit C2 notebook runtime", () => {
    const decoded = Schema.decodeUnknownSync(ScientificNotebookCreateSchema)({
      project_id: "project-01",
      owner_id: "scientist-01",
      runtime: "python-smolvm",
      document_path: "agent-collaboration-python-smolvm.ipynb",
      classification: "C2",
      compute_profile_id: "gpu-small",
      image_digest: `sha256:${"e".repeat(64)}`,
      expires_at: "2026-07-28T16:00:00Z",
    });

    expect(decoded.runtime).toBe("python-smolvm");
    expect(decoded.classification).toBe("C2");
  });

  test("accepts legacy notebook sessions without runtime identity", () => {
    const decoded = Schema.decodeUnknownSync(ScientificNotebookSessionSchema)({
      id: "notebook-legacy",
      project_id: "project-01",
      owner_id: "scientist-01",
      state: "ready",
      classification: "C2",
      compute_profile_id: "gpu-small",
      image_digest: `sha256:${"d".repeat(64)}`,
      created_at: "2026-07-27T16:00:00Z",
      updated_at: "2026-07-27T16:00:00Z",
      expires_at: "2026-07-28T16:00:00Z",
    });

    expect(decoded.runtime).toBeUndefined();
    expect(decoded.document_path).toBeUndefined();
    expect(decoded.owner_principal).toBeUndefined();
  });

  test("accepts a governed C2 Ray job submission", () => {
    const decoded = Schema.decodeUnknownSync(ScientificRayJobSubmissionSchema)(submission());

    expect(decoded.classification).toBe("C2");
    expect(validateScientificRayJobSubmission(decoded)).toEqual([]);
  });

  test("rejects a writable dataset attachment at the schema boundary", () => {
    const base = submission();
    const value = {
      ...base,
      datasets: [{ ...base.datasets[0], access: "read-write" }],
    };

    expect(() => Schema.decodeUnknownSync(ScientificRayJobSubmissionSchema)(value)).toThrow();
  });

  test("reports unsafe compute, identity, evidence, and approval values", () => {
    const base = submission();
    const dataset = base.datasets[0];
    const model = base.models[0];
    if (dataset === undefined || model === undefined) {
      throw new Error("test fixture requires a dataset and model");
    }
    const value: ScientificRayJobSubmission = {
      ...base,
      compute_profile: { ...base.compute_profile, max_workers: -1 },
      environment_digest: "latest",
      datasets: [{ ...dataset, digest: "mutable" }],
      models: [{ ...model, qualified_id: model.model_id }],
      approval_ids: [],
    };

    expect(validateScientificRayJobSubmission(value)).toEqual([
      {
        field: "compute_profile.max_workers",
        reason: "must be greater than or equal to min_workers",
      },
      {
        field: "environment_digest",
        reason: "must include an algorithm-prefixed digest",
      },
      {
        field: "datasets.0.digest",
        reason: "must include an algorithm-prefixed digest",
      },
      {
        field: "models.0.qualified_id",
        reason: "must equal provider_id/model_id",
      },
      { field: "approval_ids", reason: "requires at least one approval" },
    ]);
  });
});
