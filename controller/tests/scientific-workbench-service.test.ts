import { describe, expect, test } from "bun:test";
import type {
  ScientificNotebookSession,
  ScientificRayJobSubmission,
} from "@local-studio/contracts/scientific-workbench";
import type { NotebookInteractionEvent } from "@local-studio/contracts/notebook-agent";
import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import { Effect } from "effect";
import { ScientificWorkbenchStore } from "../src/modules/workbench/store";
import {
  admitScientificRayJob,
  createScientificExperimentReceipt,
  createScientificRayJobRecord,
  discoverScientificModelCatalog,
  issueScientificComputeLease,
  issueScientificDatasetAttachment,
  transitionScientificNotebook,
} from "../src/modules/workbench/service";

const notebook = (): ScientificNotebookSession => ({
  id: "notebook-01",
  project_id: "project-01",
  owner_id: "scientist-01",
  runtime: "node-smolvm",
  document_path: "agent-collaboration-node.ipynb",
  state: "ready",
  classification: "C2",
  compute_profile_id: "gpu-small",
  image_digest: `sha256:${"d".repeat(64)}`,
  created_at: "2026-07-27T16:00:00Z",
  updated_at: "2026-07-27T16:00:00Z",
  expires_at: "2026-07-28T16:00:00Z",
});

const notebookRevision = `sha256:${"1".repeat(64)}`;
const notebookInteractions: NotebookInteractionEvent[] = [
  {
    id: "interaction-01",
    notebook_id: "notebook-01",
    project_id: "project-01",
    actor_id: "scientist-01",
    operation: "execute",
    revision_before: notebookRevision,
    revision_after: notebookRevision,
    cell_index: 0,
    approval_id: "approval-01",
    occurred_at: "2026-07-27T16:05:00Z",
  },
];
const enterprisePrincipal: NormalizedPrincipal = {
  subject: "scientist-01",
  issuer: "https://identity.example.test/realms/science",
  issuer_id: "keycloak",
  tenant: "science",
  display_name: "Scientist",
  roles: ["scientist"],
  entitlements: ["notebook:read", "notebook:execute", "ray:admit"],
  clearance: "C2",
  issued_at: 1,
  expires_at: 2,
};

const submission = (): ScientificRayJobSubmission => ({
  id: "submission-01",
  project_id: "project-01",
  notebook_id: "notebook-01",
  compute_lease_id: "lease-01",
  experiment_id: "Experiment_01",
  classification: "C2",
  compute_profile: {
    id: "gpu-small",
    name: "GPU small",
    cpu_cores: 8,
    memory_gb: 32,
    gpu_count: 1,
    gpu_resource: "nvidia.com/gpu",
    min_workers: 1,
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
      model_id: "qwen3-next-80b-a3b-nvfp4",
      qualified_id: "tensorprime/qwen3-next-80b-a3b-nvfp4",
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

const governance = () => {
  const value = submission();
  return {
    computeLease: {
      id: "lease-01",
      project_id: "project-01",
      notebook_id: "notebook-01",
      profile_id: "gpu-small",
      profile: value.compute_profile,
      classification: "C2" as const,
      state: "admitted" as const,
      requested_at: "2026-07-27T15:59:00Z",
      expires_at: "2026-07-28T00:00:00Z",
    },
    datasetAttachments: new Map(
      value.datasets.map((attachment) => [attachment.attachment_id, attachment]),
    ),
    modelCatalog: new Map([["tensorprime", new Set(["qwen3-next-80b-a3b-nvfp4"])]]),
    now: "2026-07-27T16:00:00Z",
  };
};

describe("scientific workbench service", () => {
  test("admits a governed submission and generates a constrained RayJob", () => {
    const value = submission();

    expect(() =>
      admitScientificRayJob(value, notebook(), new Set(["tensorprime"]), governance()),
    ).not.toThrow();

    const record = createScientificRayJobRecord(value, "2026-07-27T16:01:00Z", enterprisePrincipal);
    const pod = record.resource.spec.rayClusterSpec.headGroupSpec.template.spec;

    expect(record.resource.metadata.name).toBe("experiment-experiment-01");
    expect(record.resource.metadata.namespace).toBe("workbench-project-01");
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.containers[0]?.image).toBe(value.environment_image);
    expect(pod.containers[0]?.env).toContainEqual({
      name: "LOCAL_STUDIO_ENTERPRISE_SUBJECT",
      value: "scientist-01",
    });
    expect(record.resource.spec.rayClusterSpec.workerGroupSpecs[0]?.maxReplicas).toBe(4);
  });

  test("rejects a model provider that is not configured", () => {
    try {
      admitScientificRayJob(submission(), notebook(), new Set(), governance());
      throw new Error("expected admission to fail");
    } catch (error) {
      expect((error as { detail?: string }).detail).toBe(
        'Model provider "tensorprime" is not configured',
      );
    }
  });

  test("rejects submission while its notebook is still provisioning", () => {
    const pending = { ...notebook(), state: "provisioning" as const };

    try {
      admitScientificRayJob(submission(), pending, new Set(["tensorprime"]), governance());
      throw new Error("expected admission to fail");
    } catch (error) {
      expect((error as { detail?: string }).detail).toBe(
        'Notebook "notebook-01" is not ready for job submission',
      );
    }
  });

  test("persists notebooks and admitted RayJob documents", async () => {
    const store = new ScientificWorkbenchStore(":memory:");
    const notebookValue = notebook();
    const submissionValue = submission();
    const record = createScientificRayJobRecord(submissionValue, "2026-07-27T16:01:00Z");

    await Effect.runPromise(store.saveNotebook(notebookValue));
    await Effect.runPromise(store.saveRayJob(submissionValue, record));

    expect(await Effect.runPromise(store.getNotebook(notebookValue.id))).toEqual(notebookValue);
    expect(await Effect.runPromise(store.listRayJobs(notebookValue.project_id))).toEqual([record]);
    expect(await Effect.runPromise(store.getRayJob(record.id))).toEqual(record);
    await Effect.runPromise(store.close());
  });

  test("persists controller-issued compute and dataset leases", async () => {
    const store = new ScientificWorkbenchStore(":memory:");
    const admission = governance();
    const attachment = submission().datasets[0]!;

    await Effect.runPromise(store.saveComputeLease(admission.computeLease));
    await Effect.runPromise(store.saveDatasetAttachment(attachment));

    expect(await Effect.runPromise(store.getComputeLease("lease-01"))).toEqual(
      admission.computeLease,
    );
    expect(await Effect.runPromise(store.getDatasetAttachment("attachment-01"))).toEqual(
      attachment,
    );
    await Effect.runPromise(store.close());
  });

  test("issues server-owned lease and read-only dataset identities", () => {
    const value = submission();
    const lease = issueScientificComputeLease(
      {
        project_id: value.project_id,
        notebook_id: value.notebook_id,
        profile: value.compute_profile,
        classification: "C2",
        expires_at: "2026-07-28T00:00:00Z",
      },
      notebook(),
      "2026-07-27T16:00:00Z",
    );
    const attachment = issueScientificDatasetAttachment(
      {
        project_id: value.project_id,
        dataset_id: "dataset-01",
        version: "2026-07-27",
        digest: `sha256:${"b".repeat(64)}`,
        classification: "C2",
        purpose: "model evaluation",
        lease_expires_at: "2026-07-28T00:00:00Z",
      },
      "2026-07-27T16:00:00Z",
    );

    expect(lease.id).not.toBe("");
    expect(lease.state).toBe("admitted");
    expect(lease.profile).toEqual(value.compute_profile);
    expect(attachment.attachment_id).not.toBe("");
    expect(attachment.access).toBe("read-only");
  });

  test("rejects expired compute and dataset authority", () => {
    const expiredLease = governance();
    expiredLease.computeLease.expires_at = "2026-07-27T15:00:00Z";
    expect(() =>
      admitScientificRayJob(submission(), notebook(), new Set(["tensorprime"]), expiredLease),
    ).toThrow();

    const expiredDataset = governance();
    const attachment = {
      ...submission().datasets[0]!,
      lease_expires_at: "2026-07-27T15:00:00Z",
    };
    expiredDataset.datasetAttachments = new Map([[attachment.attachment_id, attachment]]);
    const value = { ...submission(), datasets: [attachment] };
    expect(() =>
      admitScientificRayJob(value, notebook(), new Set(["tensorprime"]), expiredDataset),
    ).toThrow();
  });

  test("rejects a model absent from the authoritative provider catalog", () => {
    const admission = governance();
    admission.modelCatalog = new Map([["tensorprime", new Set(["gemma-4-26b-nvfp4"])]]);
    expect(() =>
      admitScientificRayJob(submission(), notebook(), new Set(["tensorprime"]), admission),
    ).toThrow();
  });

  test("enforces the notebook lifecycle graph", () => {
    const provisioning = {
      ...notebook(),
      state: "provisioning" as const,
    };
    const ready = transitionScientificNotebook(provisioning, "ready", "2026-07-27T16:02:00Z");

    expect(ready.state).toBe("ready");
    try {
      transitionScientificNotebook({ ...ready, state: "archived" }, "active", ready.updated_at);
      throw new Error("expected transition to fail");
    } catch (error) {
      expect((error as { detail?: string }).detail).toBe(
        "Notebook cannot transition from archived to active",
      );
    }
  });

  test("creates and persists a terminal experiment receipt from measured evidence", async () => {
    const store = new ScientificWorkbenchStore(":memory:");
    const notebookValue = notebook();
    const submissionValue = submission();
    const job = {
      ...createScientificRayJobRecord(submissionValue, "2026-07-27T16:01:00Z", enterprisePrincipal),
      state: "succeeded" as const,
      submitted_at: "2026-07-27T16:02:00Z",
      reconciled_at: "2026-07-27T16:12:00Z",
      cluster: {
        uid: "ray-job-uid",
        resource_version: "4",
        job_status: "SUCCEEDED",
        deployment_status: "Complete",
        message: null,
        started_at: "2026-07-27T16:03:00Z",
        ended_at: "2026-07-27T16:11:00Z",
        resource_usage: {
          cpu_seconds: 600,
          gpu_seconds: 480,
          peak_memory_gb: 24,
        },
        artifact_digests: [`sha256:${"e".repeat(64)}`],
        policy_decision_ids: ["policy-decision-01"],
        apim_correlation_ids: ["apim-correlation-01"],
        agent_ids: ["foundry/research-agent"],
      },
    };
    const receipt = createScientificExperimentReceipt(
      job,
      notebookValue,
      notebookRevision,
      notebookInteractions,
      {
        artifact_digests: [`sha256:${"e".repeat(64)}`],
        policy_decision_ids: ["policy-decision-01"],
        resource_usage: {
          cpu_seconds: 600,
          gpu_seconds: 480,
          peak_memory_gb: 24,
        },
      },
      "receipt-signing-key-with-32-bytes-minimum",
      {
        ...enterprisePrincipal,
        subject: "platform-admin",
        roles: ["platform_admin"],
      },
      [
        {
          id: "foundry-evidence-01",
          submission_id: submissionValue.id,
          principal: {
            subject: enterprisePrincipal.subject,
            issuer: enterprisePrincipal.issuer,
            issuer_id: enterprisePrincipal.issuer_id,
            tenant: enterprisePrincipal.tenant,
            clearance: enterprisePrincipal.clearance,
          },
          kind: "agent",
          provider_id: "foundry",
          resource_id: "research-agent",
          correlation_id: "foundry-correlation-01",
          observed_at: "2026-07-27T16:06:00Z",
        },
      ],
    );

    expect(receipt.ray_job_id).toBe("ray-job-uid");
    expect(receipt.state).toBe("succeeded");
    expect(receipt.notebook_digest).toBe(notebookValue.image_digest);
    expect(receipt.notebook_revision).toBe(notebookRevision);
    expect(receipt.notebook_interaction_count).toBe(1);
    expect(receipt.notebook_interaction_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.completed_at).toBe("2026-07-27T16:11:00Z");
    expect(receipt.receipt_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.receipt_signature).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(receipt.evidence_source).toBe("controller-reconciled");
    expect(receipt.apim_correlation_ids).toEqual(["apim-correlation-01", "foundry-correlation-01"]);
    expect(receipt.principal).toEqual({
      subject: "scientist-01",
      issuer: "https://identity.example.test/realms/science",
      issuer_id: "keycloak",
      tenant: "science",
      clearance: "C2",
    });
    expect(receipt.agents).toEqual([{ provider_id: "foundry", agent_id: "research-agent" }]);
    expect(receipt.foundry_invocations).toEqual([
      {
        kind: "agent",
        provider_id: "foundry",
        resource_id: "research-agent",
        correlation_id: "foundry-correlation-01",
        principal: {
          subject: "scientist-01",
          issuer: "https://identity.example.test/realms/science",
          issuer_id: "keycloak",
          tenant: "science",
          clearance: "C2",
        },
      },
    ]);

    await Effect.runPromise(store.saveReceipt(submissionValue.project_id, receipt));
    await Effect.runPromise(
      store.saveFoundryInvocationEvidence({
        id: "foundry-evidence-01",
        submission_id: submissionValue.id,
        principal: {
          subject: enterprisePrincipal.subject,
          issuer: enterprisePrincipal.issuer,
          issuer_id: enterprisePrincipal.issuer_id,
          tenant: enterprisePrincipal.tenant,
          clearance: enterprisePrincipal.clearance,
        },
        kind: "model",
        provider_id: "foundry",
        resource_id: "model-01",
        correlation_id: "correlation-01",
        observed_at: "2026-07-27T16:05:00Z",
      }),
    );
    expect(await Effect.runPromise(store.getReceipt(receipt.id))).toEqual(receipt);
    expect(await Effect.runPromise(store.getReceiptBySubmission(submissionValue.id))).toEqual(
      receipt,
    );
    expect(
      await Effect.runPromise(store.listFoundryInvocationEvidence(submissionValue.id)),
    ).toEqual([
      expect.objectContaining({
        id: "foundry-evidence-01",
        correlation_id: "correlation-01",
      }),
    ]);
    await Effect.runPromise(
      store.saveFoundryInvocationEvidence({
        id: "foundry-evidence-01",
        submission_id: submissionValue.id,
        principal: {
          subject: "platform-admin",
          issuer: enterprisePrincipal.issuer,
          issuer_id: enterprisePrincipal.issuer_id,
          tenant: enterprisePrincipal.tenant,
          clearance: "C2",
        },
        kind: "agent",
        provider_id: "forged-provider",
        resource_id: "forged-agent",
        correlation_id: "forged-correlation",
        observed_at: "2026-07-27T16:07:00Z",
      }),
    );
    expect(
      await Effect.runPromise(store.listFoundryInvocationEvidence(submissionValue.id)),
    ).toEqual([
      expect.objectContaining({
        principal: expect.objectContaining({ subject: enterprisePrincipal.subject }),
        kind: "model",
        provider_id: "foundry",
        resource_id: "model-01",
        correlation_id: "correlation-01",
      }),
    ]);
    await Effect.runPromise(store.close());
  });

  test("uses controller evidence instead of caller receipt claims", () => {
    const value = submission();
    const record = createScientificRayJobRecord(value, "2026-07-27T16:01:00Z", enterprisePrincipal);
    const job = {
      ...record,
      state: "succeeded" as const,
      reconciled_at: "2026-07-27T16:11:00Z",
      cluster: {
        uid: "uid-01",
        resource_version: "7",
        job_status: "SUCCEEDED",
        deployment_status: "Complete",
        message: null,
        started_at: "2026-07-27T16:02:00Z",
        ended_at: "2026-07-27T16:10:00Z",
        resource_usage: { cpu_seconds: 12, gpu_seconds: 8, peak_memory_gb: 4 },
        artifact_digests: [`sha256:${"f".repeat(64)}`],
        policy_decision_ids: ["measured-policy"],
      },
    };
    const receipt = createScientificExperimentReceipt(
      job,
      notebook(),
      notebookRevision,
      notebookInteractions,
      {
        artifact_digests: [`sha256:${"0".repeat(64)}`],
        policy_decision_ids: ["caller-policy"],
        resource_usage: { cpu_seconds: 999, gpu_seconds: 999, peak_memory_gb: 999 },
      },
      "receipt-signing-key-with-32-bytes-minimum",
    );

    expect(receipt.policy_decision_ids).toEqual(["measured-policy"]);
    expect(receipt.artifact_digests).toEqual([`sha256:${"f".repeat(64)}`]);
    expect(receipt.resource_usage.cpu_seconds).toBe(12);
    expect(() =>
      createScientificExperimentReceipt(
        job,
        notebook(),
        notebookRevision,
        notebookInteractions,
        {
          artifact_digests: [],
          policy_decision_ids: [],
          resource_usage: { cpu_seconds: 0, gpu_seconds: 0, peak_memory_gb: 0 },
        },
        "receipt-signing-key-with-32-bytes-minimum",
        enterprisePrincipal,
        [
          {
            id: "cross-tenant-evidence",
            submission_id: value.id,
            principal: {
              subject: "scientist-2",
              issuer: enterprisePrincipal.issuer,
              issuer_id: enterprisePrincipal.issuer_id,
              tenant: "other",
              clearance: "C2",
            },
            kind: "model",
            provider_id: "foundry",
            resource_id: "model-01",
            correlation_id: "correlation-02",
            observed_at: "2026-07-27T16:06:00Z",
          },
        ],
      ),
    ).toThrow();
  });

  test("discovers authoritative model IDs without exposing provider secrets", async () => {
    let authorization = "";
    const catalog = await Effect.runPromise(
      discoverScientificModelCatalog(
        [
          {
            id: "tensorprime",
            name: "TensorPrime",
            base_url: "http://api.tprime.vlans.ca/v1",
            enabled: true,
            authentication: {
              type: "api_key",
              secret_ref: "provider:tensorprime:api-key",
            },
          },
        ],
        async (input, init) => {
          authorization = new Headers(init?.headers).get("authorization") ?? "";
          expect(String(input)).toBe("http://api.tprime.vlans.ca/v1/models");
          return Response.json({
            data: [{ id: "gemma-4-26b-nvfp4" }, { id: "qwen3-next-80b-a3b-nvfp4" }],
          });
        },
        { directApiKey: "placeholder" },
      ),
    );

    expect(catalog.get("tensorprime")).toEqual(
      new Set(["gemma-4-26b-nvfp4", "qwen3-next-80b-a3b-nvfp4"]),
    );
    expect(authorization).toBe("Bearer placeholder");
  });

  test("refuses an experiment receipt before the RayJob reaches a terminal state", () => {
    try {
      createScientificExperimentReceipt(
        createScientificRayJobRecord(submission(), "2026-07-27T16:01:00Z"),
        notebook(),
        notebookRevision,
        notebookInteractions,
        {
          artifact_digests: [],
          policy_decision_ids: [],
          resource_usage: {
            cpu_seconds: 0,
            gpu_seconds: 0,
            peak_memory_gb: 0,
          },
        },
        "receipt-signing-key-with-32-bytes-minimum",
      );
      throw new Error("expected receipt generation to fail");
    } catch (error) {
      expect((error as { detail?: string }).detail).toBe(
        "Experiment receipt requires a terminal RayJob",
      );
    }
  });
});
