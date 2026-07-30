import { describe, expect, test } from "bun:test";
import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import type {
  ScientificExperimentReceipt,
  ScientificNotebookSession,
} from "@local-studio/contracts/scientific-workbench";
import {
  bindScientificNotebookOwner,
  canAccessScientificNotebook,
  canAccessScientificReceipt,
  canAccessScientificRayJob,
  requireScientificNotebookAccess,
  requireScientificNotebookMutationOwner,
  requireScientificSubmissionOwner,
  scientificActorId,
} from "../src/modules/workbench/enterprise-identity";

const principal = (overrides: Partial<NormalizedPrincipal> = {}): NormalizedPrincipal => ({
  subject: "subject-1",
  issuer: "https://identity.example.test/realms/science",
  issuer_id: "keycloak",
  tenant: "science",
  display_name: "Scientist",
  roles: ["scientist"],
  entitlements: ["notebook:read", "notebook:execute", "ray:admit"],
  clearance: "C2",
  issued_at: 1,
  expires_at: 2,
  ...overrides,
});

const notebook = (owner_id = "subject-1", scoped = true): ScientificNotebookSession => ({
  id: "notebook-1",
  project_id: "project-1",
  owner_id,
  ...(scoped
    ? {
        owner_principal: {
          subject: owner_id,
          issuer: "https://identity.example.test/realms/science",
          issuer_id: "keycloak",
          tenant: "science",
          clearance: "C2" as const,
        },
      }
    : {}),
  runtime: "python-smolvm",
  document_path: "notebook.ipynb",
  state: "ready",
  classification: "C2",
  compute_profile_id: "gpu-small",
  image_digest: `sha256:${"a".repeat(64)}`,
  created_at: "2026-07-29T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
  expires_at: "2026-07-30T00:00:00.000Z",
});

describe("scientific enterprise identity", () => {
  test("derives actor and owner identity from the validated enterprise principal", () => {
    expect(scientificActorId(principal(), "forged-browser-user")).toBe("subject-1");
    expect(bindScientificNotebookOwner(principal(), "subject-1")).toBe("subject-1");
    expect(() => bindScientificNotebookOwner(principal(), "forged-browser-user")).toThrow();
  });

  test("preserves loopback-local actor compatibility", () => {
    expect(scientificActorId(undefined, " scientist-1 ")).toBe("scientist-1");
    expect(bindScientificNotebookOwner(undefined, " scientist-1 ")).toBe("scientist-1");
  });

  test("limits mutations and submissions to the immutable subject", () => {
    expect(requireScientificNotebookMutationOwner(principal(), notebook())).toEqual(notebook());
    expect(() =>
      requireScientificNotebookMutationOwner(principal(), notebook("subject-2")),
    ).toThrow();
    expect(() => requireScientificSubmissionOwner(principal(), "subject-2")).toThrow();
  });

  test("permits explicit platform administration without rewriting ownership", () => {
    const admin = principal({ roles: ["platform_admin"] });
    expect(requireScientificNotebookMutationOwner(admin, notebook("subject-2")).owner_id).toBe(
      "subject-2",
    );
  });

  test("keeps platform administration inside the issuing tenant", () => {
    const admin = principal({ roles: ["platform_admin"] });
    expect(
      canAccessScientificNotebook(admin, {
        ...notebook("subject-2"),
        owner_principal: {
          ...notebook("subject-2").owner_principal!,
          tenant: "other-science",
        },
      }),
    ).toBe(false);
    expect(
      canAccessScientificNotebook(
        principal({
          issuer: "https://other.example.test/realms/science",
          issuer_id: "other",
        }),
        notebook(),
      ),
    ).toBe(false);
    expect(
      canAccessScientificNotebook(admin, {
        ...notebook("subject-2"),
        owner_principal: {
          ...notebook("subject-2").owner_principal!,
          issuer: "https://other.example.test/realms/science",
        },
      }),
    ).toBe(false);
  });

  test("keeps legacy records owner-only and scopes Ray access to admission identity", () => {
    const admin = principal({ roles: ["platform_admin"] });
    expect(canAccessScientificNotebook(admin, notebook("subject-2", false))).toBe(false);
    expect(
      canAccessScientificRayJob(principal(), {
        id: "job-1",
        state: "queued",
        submission: {
          id: "job-1",
          project_id: "project-1",
          notebook_id: "notebook-1",
          compute_lease_id: "lease-1",
          experiment_id: "experiment-1",
          classification: "C2",
          compute_profile: {
            id: "gpu-small",
            name: "GPU small",
            cpu_cores: 1,
            memory_gb: 2,
            gpu_count: 0,
            gpu_resource: null,
            min_workers: 0,
            max_workers: 1,
            max_runtime_minutes: 5,
            idle_timeout_minutes: 5,
            network_policy: "deny-by-default",
            classification_ceiling: "C2",
          },
          environment_image: `registry.example.test/science@sha256:${"a".repeat(64)}`,
          environment_digest: `sha256:${"a".repeat(64)}`,
          entrypoint: "python main.py",
          datasets: [],
          models: [],
          parameters: {},
          random_seeds: [],
          approval_ids: ["approval-1"],
          requested_by: "forged-browser-user",
          requested_at: "2026-07-29T00:00:00.000Z",
        },
        admission_principal: {
          subject: "subject-1",
          issuer: "https://identity.example.test/realms/science",
          issuer_id: "keycloak",
          tenant: "science",
          clearance: "C2",
        },
        resource: {
          apiVersion: "ray.io/v1",
          kind: "RayJob",
          metadata: { name: "job-1", namespace: "project-1", labels: {}, annotations: {} },
          spec: {
            entrypoint: "python main.py",
            shutdownAfterJobFinishes: true,
            ttlSecondsAfterFinished: 3600,
            rayClusterSpec: {
              headGroupSpec: {
                rayStartParams: {},
                template: { spec: { automountServiceAccountToken: false, containers: [] } },
              },
              workerGroupSpecs: [],
            },
          },
        },
        admitted_at: "2026-07-29T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(() => requireScientificNotebookAccess(principal(), notebook("subject-2"))).toThrowError(
      expect.objectContaining({
        status: 404,
        detail: "Notebook not found",
      }),
    );
    const legacyReceipt = {
      principal: {
        subject: "subject-1",
        issuer_id: "keycloak",
        tenant: "science",
        clearance: "C2",
      },
    } as ScientificExperimentReceipt;
    expect(canAccessScientificReceipt(principal(), legacyReceipt)).toBe(true);
    expect(canAccessScientificReceipt(principal({ issuer_id: "other" }), legacyReceipt)).toBe(
      false,
    );
  });
});
