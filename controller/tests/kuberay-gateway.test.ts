import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScientificRayJobSubmission } from "@local-studio/contracts/scientific-workbench";
import { Effect } from "effect";
import { KubeRayGateway } from "../src/modules/workbench/kuberay-gateway";
import { createScientificRayJobRecord } from "../src/modules/workbench/service";

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
    min_workers: 1,
    max_workers: 4,
    max_runtime_minutes: 240,
    idle_timeout_minutes: 30,
    network_policy: "deny-by-default",
    classification_ceiling: "C2",
  },
  environment_image: `registry.internal/science@sha256:${"c".repeat(64)}`,
  environment_digest: `sha256:${"a".repeat(64)}`,
  entrypoint: "python train.py",
  datasets: [],
  models: [
    {
      provider_id: "tensorprime",
      model_id: "qwen",
      qualified_id: "tensorprime/qwen",
      endpoint_class: "openai-compatible",
      tool_mode: "none",
    },
  ],
  parameters: {},
  random_seeds: [42],
  approval_ids: ["approval-01"],
  requested_by: "scientist-01",
  requested_at: "2026-07-27T16:00:00Z",
});

describe("KubeRay gateway", () => {
  test("uses server-side apply with workload identity and maps running status", async () => {
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    const gateway = new KubeRayGateway(
      {
        apiUrl: "https://kubernetes.example",
        tokenFile: "/token",
      },
      (input, init) => {
        observedUrl = String(input);
        observedInit = init;
        return Effect.succeed(
          Response.json({
            metadata: { uid: "uid-01", resourceVersion: "17" },
            status: {
              jobStatus: "RUNNING",
              jobDeploymentStatus: "Running",
              startTime: "2026-07-27T16:02:00Z",
            },
          }),
        );
      },
      () => "workload-token",
    );
    const record = createScientificRayJobRecord(submission(), "2026-07-27T16:01:00Z");

    const updated = await Effect.runPromise(
      gateway.submit(record, "2026-07-27T16:02:00Z"),
    );
    const headers = new Headers(observedInit?.headers);

    expect(observedInit?.method).toBe("PATCH");
    expect(headers.get("content-type")).toBe("application/apply-patch+yaml");
    expect(headers.get("authorization")).toBe("Bearer workload-token");
    expect(observedUrl).toContain(
      "/apis/ray.io/v1/namespaces/workbench-project-01/rayjobs/experiment-experiment-01",
    );
    expect(observedUrl).toContain("fieldManager=local-studio-workbench");
    expect(updated.state).toBe("running");
    expect(updated.cluster?.resource_version).toBe("17");
  });

  test("reconciles complete KubeRay status to succeeded", async () => {
    const gateway = new KubeRayGateway(
      { apiUrl: "https://kubernetes.example", tokenFile: "/token" },
      () =>
        Effect.succeed(
          Response.json({
            metadata: { uid: "uid-01", resourceVersion: "18" },
            status: {
              jobStatus: "SUCCEEDED",
              jobDeploymentStatus: "Complete",
              message: "Job finished successfully.",
              endTime: "2026-07-27T16:10:00Z",
            },
          }),
        ),
      () => "workload-token",
    );
    const queued = createScientificRayJobRecord(submission(), "2026-07-27T16:01:00Z");
    const submitted = { ...queued, state: "submitted" as const };

    const updated = await Effect.runPromise(
      gateway.reconcile(submitted, "2026-07-27T16:11:00Z"),
    );

    expect(updated.state).toBe("succeeded");
    expect(updated.cluster?.message).toBe("Job finished successfully.");
    expect(updated.cluster?.ended_at).toBe("2026-07-27T16:10:00Z");
  });

  test("fails closed on malformed cluster responses", async () => {
    const gateway = new KubeRayGateway(
      { apiUrl: "https://kubernetes.example", tokenFile: "/token" },
      () => Effect.succeed(Response.json({ status: "not-a-RayJob" })),
      () => "workload-token",
    );

    try {
      await Effect.runPromise(
        gateway.submit(
          createScientificRayJobRecord(submission(), "2026-07-27T16:01:00Z"),
          "2026-07-27T16:02:00Z",
        ),
      );
      throw new Error("expected gateway to fail");
    } catch (error) {
      expect((error as { detail?: string }).detail).toBe(
        "KubeRay API returned an invalid RayJob document",
      );
    }
  });

  test("refuses invalid submit and reconcile transitions", async () => {
    const gateway = new KubeRayGateway(
      { apiUrl: "https://kubernetes.example", tokenFile: "/token" },
      () => Effect.succeed(Response.json({ metadata: {} })),
      () => "workload-token",
    );
    const queued = createScientificRayJobRecord(submission(), "2026-07-27T16:01:00Z");

    await expect(
      Effect.runPromise(gateway.submit({ ...queued, state: "succeeded" }, "2026-07-27T16:02:00Z")),
    ).rejects.toBeDefined();
    await expect(
      Effect.runPromise(gateway.reconcile(queued, "2026-07-27T16:02:00Z")),
    ).rejects.toBeDefined();
  });

  test("observes Kubernetes and Ray API versions with the workload credential", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const gateway = new KubeRayGateway(
      {
        apiUrl: "https://cluster.internal",
        tokenFile: "/run/secrets/kubernetes/token",
      },
      (input, init) => {
        const url = String(input);
        requests.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Effect.succeed(
          Response.json(
            url.endsWith("/version")
              ? { gitVersion: "v1.33.1" }
              : {
                  groupVersion: "ray.io/v1",
                  resources: [{ name: "rayjobs", verbs: ["get", "patch"] }],
                },
          ),
        );
      },
      () => "workload-token\n",
    );

    const result = await Effect.runPromise(gateway.probe());

    expect(result).toEqual({
      kubernetesVersion: "v1.33.1",
      rayApiVersion: "ray.io/v1",
    });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.authorization === "Bearer workload-token")).toBe(
      true,
    );
  });

  test("fails closed on an invalid Ray API discovery document", async () => {
    const gateway = new KubeRayGateway(
      {
        apiUrl: "https://cluster.internal",
        tokenFile: "/run/secrets/kubernetes/token",
      },
      (input) =>
        Effect.succeed(
          Response.json(
            String(input).endsWith("/version") ? { gitVersion: "v1.33.1" } : { resources: [] },
          ),
        ),
      () => "workload-token",
    );

    await expect(Effect.runPromise(gateway.probe())).rejects.toBeDefined();
  });

  test("rejects Ray API discovery without required operations", async () => {
    const gateway = new KubeRayGateway(
      {
        apiUrl: "https://cluster.internal",
        tokenFile: "/run/secrets/kubernetes/token",
      },
      (input) =>
        Effect.succeed(
          Response.json(
            String(input).endsWith("/version")
              ? { gitVersion: "v1.33.1" }
              : {
                  groupVersion: "ray.io/v1",
                  resources: [{ name: "rayjobs", verbs: ["get"] }],
                },
          ),
        ),
      () => "workload-token",
    );

    await expect(Effect.runPromise(gateway.probe())).rejects.toMatchObject({
      detail: "RayJob API does not advertise required get and patch operations",
    });
  });

  test("sanitizes credential and transport failures", async () => {
    const credentialFailure = new KubeRayGateway(
      { apiUrl: "https://cluster.internal", tokenFile: "/private/secret" },
      () => Effect.die("fetch must not run"),
      () => {
        throw new Error("ENOENT /private/secret");
      },
    );
    const transportFailure = new KubeRayGateway(
      { apiUrl: "https://cluster.internal", tokenFile: "/token" },
      () => Effect.fail(new Error("connect ECONNREFUSED 10.0.0.1")),
      () => "workload-token",
    );

    await expect(Effect.runPromise(credentialFailure.probe())).rejects.toMatchObject({
      detail: "KubeRay credential material is unavailable",
    });
    await expect(Effect.runPromise(transportFailure.probe())).rejects.toMatchObject({
      detail: "KubeRay API request failed",
    });
  });

  test("submits and reconciles against a protocol-faithful HTTP fixture", async () => {
    const directory = mkdtempSync(join(tmpdir(), "local-studio-kuberay-"));
    const tokenFile = join(directory, "token");
    writeFileSync(tokenFile, "fixture-workload-token", { mode: 0o600 });
    let patchObserved = false;
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const authorization = request.headers.get("authorization");
        if (authorization !== "Bearer fixture-workload-token") {
          return Response.json({ message: "unauthorized" }, { status: 401 });
        }
        if (request.method === "PATCH") {
          patchObserved = true;
          expect(request.headers.get("content-type")).toBe("application/apply-patch+yaml");
          expect((await request.json() as { kind?: string }).kind).toBe("RayJob");
          return Response.json({
            metadata: { uid: "fixture-uid", resourceVersion: "1" },
            status: { jobStatus: "RUNNING", jobDeploymentStatus: "Running" },
          });
        }
        return Response.json({
          metadata: { uid: "fixture-uid", resourceVersion: "2" },
          status: {
            jobStatus: "SUCCEEDED",
            jobDeploymentStatus: "Complete",
            endTime: "2026-07-28T20:00:00Z",
          },
        });
      },
    });
    try {
      const gateway = new KubeRayGateway({
        apiUrl: `http://127.0.0.1:${server.port}`,
        tokenFile,
      });
      const queued = createScientificRayJobRecord(submission(), "2026-07-28T19:59:00Z");
      const submitted = await Effect.runPromise(
        gateway.submit(queued, "2026-07-28T19:59:10Z"),
      );
      const terminal = await Effect.runPromise(
        gateway.reconcile(submitted, "2026-07-28T20:00:01Z"),
      );

      expect(patchObserved).toBe(true);
      expect(submitted.state).toBe("running");
      expect(terminal.state).toBe("succeeded");
      expect(terminal.cluster?.resource_version).toBe("2");
    } finally {
      server.stop(true);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
