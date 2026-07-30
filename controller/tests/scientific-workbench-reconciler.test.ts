import { describe, expect, test } from "bun:test";
import type {
  ScientificNotebookSession,
  ScientificRayJobSubmission,
} from "@local-studio/contracts/scientific-workbench";
import { Effect } from "effect";
import { ScientificWorkbenchStore } from "../src/modules/workbench/store";
import { createScientificRayJobRecord } from "../src/modules/workbench/service";
import type { ScientificRayJobRecord } from "../src/modules/workbench/types";
import { reconcilePass } from "../src/modules/workbench/reconciler";
import type { KubeRayGateway } from "../src/modules/workbench/kuberay-gateway";
import type { AppContext } from "../src/app-context";

const notebook = (): ScientificNotebookSession => ({
  id: "notebook-reconcile",
  project_id: "project-reconcile",
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

const submission = (): ScientificRayJobSubmission => ({
  id: "submission-reconcile",
  project_id: "project-reconcile",
  notebook_id: "notebook-reconcile",
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
  datasets: [],
  models: [],
  parameters: { temperature: 0 },
  random_seeds: [42],
  approval_ids: ["approval-01"],
  requested_by: "scientist-01",
  requested_at: "2026-07-27T16:00:00Z",
});

type FakeGatewayOverrides = {
  reconcileResult?: Partial<ScientificRayJobRecord>;
  failTimes?: number;
};

const fakeGateway = (overrides: FakeGatewayOverrides = {}): KubeRayGateway => {
  let attempts = 0;
  const failTimes = overrides.failTimes ?? 0;
  return {
    reconcile: (record: ScientificRayJobRecord, now: string) => {
      attempts += 1;
      if (attempts <= failTimes) {
        return Effect.fail(new Error(`transient KubeRay failure ${attempts}`));
      }
      const result: ScientificRayJobRecord = {
        ...record,
        reconciled_at: now,
        ...(overrides.reconcileResult ?? {}),
      };
      return Effect.succeed(result);
    },
  } as unknown as KubeRayGateway;
};

const fakeContext = (
  store: ScientificWorkbenchStore,
  gateway: KubeRayGateway | null,
): Pick<AppContext, "stores" | "kubeRayGateway" | "logger"> => {
  const logs: { level: string; message: string }[] = [];
  return {
    stores: { scientificWorkbenchStore: store } as AppContext["stores"],
    kubeRayGateway: gateway,
    logger: {
      debug: (m: string) => logs.push({ level: "debug", message: m }),
      info: (m: string) => logs.push({ level: "info", message: m }),
      warn: (m: string) => logs.push({ level: "warn", message: m }),
      error: (m: string) => logs.push({ level: "error", message: m }),
      shutdown: () => Effect.void,
    } as AppContext["logger"],
  };
};

describe("workbench reconciler", () => {
  test("reconciles non-terminal jobs and skips terminal and queued jobs", async () => {
    const store = new ScientificWorkbenchStore(":memory:");
    const nb = notebook();
    const sub = submission();
    await Effect.runPromise(store.saveNotebook(nb));

    const queued = createScientificRayJobRecord(sub, "2026-07-27T16:01:00Z");
    const running: ScientificRayJobRecord = { ...queued, id: "job-running", state: "running" };
    const succeeded: ScientificRayJobRecord = {
      ...queued,
      id: "job-succeeded",
      state: "succeeded",
    };
    await Effect.runPromise(store.saveRayJob({ ...sub, id: "job-running" }, running));
    await Effect.runPromise(store.saveRayJob({ ...sub, id: "job-succeeded" }, succeeded));
    await Effect.runPromise(store.saveRayJob(sub, queued));

    const gateway = fakeGateway({ reconcileResult: { state: "succeeded" } });
    const context = fakeContext(store, gateway);

    await Effect.runPromise(reconcilePass(context as AppContext));

    const reconciledRunning = await Effect.runPromise(store.getRayJob("job-running"));
    expect(reconciledRunning?.state).toBe("succeeded");
    const stillSucceeded = await Effect.runPromise(store.getRayJob("job-succeeded"));
    expect(stillSucceeded?.state).toBe("succeeded");
    const stillQueued = await Effect.runPromise(store.getRayJob(sub.id));
    expect(stillQueued?.state).toBe("queued");
    await Effect.runPromise(store.close());
  });

  test("retries transient KubeRay failures within the bounded budget", async () => {
    const store = new ScientificWorkbenchStore(":memory:");
    const nb = notebook();
    const sub = submission();
    await Effect.runPromise(store.saveNotebook(nb));
    const running: ScientificRayJobRecord = {
      ...createScientificRayJobRecord(sub, "2026-07-27T16:01:00Z"),
      state: "running",
    };
    await Effect.runPromise(store.saveRayJob(sub, running));

    const gateway = fakeGateway({ failTimes: 2, reconcileResult: { state: "succeeded" } });
    const context = fakeContext(store, gateway);

    await Effect.runPromise(reconcilePass(context as AppContext, { retryBaseMs: 1, retryMax: 3 }));

    const reconciled = await Effect.runPromise(store.getRayJob(sub.id));
    expect(reconciled?.state).toBe("succeeded");
    await Effect.runPromise(store.close());
  });

  test("logs a warning and continues when a job exceeds the retry budget", async () => {
    const store = new ScientificWorkbenchStore(":memory:");
    const nb = notebook();
    const sub = submission();
    await Effect.runPromise(store.saveNotebook(nb));
    const running: ScientificRayJobRecord = {
      ...createScientificRayJobRecord(sub, "2026-07-27T16:01:00Z"),
      state: "running",
    };
    await Effect.runPromise(store.saveRayJob(sub, running));

    const gateway = fakeGateway({ failTimes: 99 });
    const context = fakeContext(store, gateway);

    await Effect.runPromise(reconcilePass(context as AppContext, { retryBaseMs: 1, retryMax: 2 }));

    const stillRunning = await Effect.runPromise(store.getRayJob(sub.id));
    expect(stillRunning?.state).toBe("running");
    await Effect.runPromise(store.close());
  });

  test("no-ops when the KubeRay gateway is unavailable", async () => {
    const store = new ScientificWorkbenchStore(":memory:");
    const nb = notebook();
    const sub = submission();
    await Effect.runPromise(store.saveNotebook(nb));
    const running: ScientificRayJobRecord = {
      ...createScientificRayJobRecord(sub, "2026-07-27T16:01:00Z"),
      state: "running",
    };
    await Effect.runPromise(store.saveRayJob(sub, running));

    const context = fakeContext(store, null);
    await Effect.runPromise(reconcilePass(context as AppContext));

    const stillRunning = await Effect.runPromise(store.getRayJob(sub.id));
    expect(stillRunning?.state).toBe("running");
    await Effect.runPromise(store.close());
  });
});
