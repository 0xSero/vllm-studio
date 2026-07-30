import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MachineEnrollmentProfile } from "@local-studio/contracts/machine-enrollment";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Hono } from "hono";
import type { AppContext } from "../src/app-context";
import type { ControllerRuntime } from "../src/core/effect-runtime";
import { isHttpStatus } from "../src/core/errors";
import {
  controllerRuntimeMiddleware,
  type ControllerEnvironment,
} from "../src/http/effect-handler";
import { createMutatingAuthMiddleware } from "../src/http/security-middleware";
import { MachineEnrollmentService } from "../src/modules/machines/enrollment-service";
import { registerMachineRoutes } from "../src/modules/machines/routes";
import { RigStore } from "../src/stores/rig-store";

const roots: string[] = [];
const root = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "machine-routes-"));
  roots.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const profile = (): MachineEnrollmentProfile => ({
  machine_id: "tensorprime-01",
  display_name: "TensorPrime 01",
  locality: "remote",
  appliance_id: "cortaix-factory",
  classification: "C2",
  rig_id: "rig-existing",
  rig_node_id: "node-existing",
  runtime_refs: [{ id: "runtime-vllm" }],
  access_refs: [
    {
      id: "access-fabric-01",
      kind: "boundary",
      endpoint: "https://boundary.example",
      credential_ref: "vault:access:boundary",
    },
  ],
  agent_refs: [{ id: "tensorprime-01:pi" }],
});

const makeApp = (directory: string) => {
  const runtime = ManagedRuntime.make(Layer.empty) as unknown as ControllerRuntime;
  const context = {
    config: { api_key: "test-api-key" },
    machineEnrollmentService: new MachineEnrollmentService(directory),
  } as unknown as AppContext;
  const app = new Hono<ControllerEnvironment>();
  app.use("*", controllerRuntimeMiddleware(runtime));
  app.use("*", createMutatingAuthMiddleware(context));
  registerMachineRoutes(app, context);
  app.onError((error, ctx) =>
    isHttpStatus(error)
      ? ctx.json({ detail: error.detail }, error.status as 400 | 404)
      : ctx.json({ detail: String(error) }, 500),
  );
  return { app, runtime };
};

const request = (
  app: Hono<ControllerEnvironment>,
  path: string,
  method = "GET",
  body?: unknown,
  authenticated = true,
) =>
  app.request(path, {
    method,
    headers: {
      ...(authenticated ? { Authorization: "Bearer test-api-key" } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("machine routes", () => {
  test("requires controller authentication and serves the complete fixture lifecycle", async () => {
    const directory = root();
    const { app, runtime } = makeApp(directory);
    expect((await request(app, "/machines", "GET", undefined, false)).status).toBe(401);
    expect((await request(app, "/machines", "POST", profile(), false)).status).toBe(401);

    const created = await request(app, "/machines", "POST", profile());
    expect(created.status).toBe(201);
    const plan = await request(app, "/machines/tensorprime-01/plan", "POST");
    expect(plan.status).toBe(200);
    expect((await plan.json() as { plan: { digest: string } }).plan.digest).toMatch(/^sha256:/);

    for (const state of ["probed", "admitted", "configured"] as const) {
      const response = await request(app, "/machines/tensorprime-01/state", "PATCH", {
        state,
        reason: `fixture ${state}`,
      });
      expect(response.status).toBe(200);
    }
    const applied = await request(app, "/machines/tensorprime-01/apply", "POST");
    expect(applied.status).toBe(200);
    const appliedBody = await applied.json() as {
      machine: { state: string; receipt: { owned_resources: Array<{ external_ref: string }> } };
    };
    expect(appliedBody.machine.state).toBe("active");
    expect(appliedBody.machine.receipt.owned_resources[0]?.external_ref).toBe(
      "loopback:machine:tensorprime-01",
    );
    expect((await request(app, "/machines/tensorprime-01/reconcile", "POST")).status).toBe(200);
    const revoked = await request(app, "/machines/tensorprime-01", "DELETE");
    expect(revoked.status).toBe(200);
    expect((await revoked.json() as { machine: { state: string } }).machine.state).toBe("revoked");
    await runtime.dispose();
  });

  test("survives service restart without changing legacy rig persistence", async () => {
    const directory = root();
    const rigStore = new RigStore(join(directory, "controller.db"));
    rigStore.save({
      id: "rig-existing",
      name: "Existing rig",
      description: null,
      nodes: [],
      created_at: "2026-07-28T12:00:00.000Z",
      updated_at: "2026-07-28T12:00:00.000Z",
    });
    const first = makeApp(directory);
    expect((await request(first.app, "/machines", "POST", profile())).status).toBe(201);
    await first.runtime.dispose();

    const second = makeApp(directory);
    const response = await request(second.app, "/machines/tensorprime-01");
    expect(response.status).toBe(200);
    expect((await response.json() as { machine: { profile: { rig_id?: string } } }).machine.profile.rig_id)
      .toBe("rig-existing");
    expect(rigStore.get("rig-existing")?.name).toBe("Existing rig");
    await Effect.runPromise(rigStore.close());
    await second.runtime.dispose();
  });
});
