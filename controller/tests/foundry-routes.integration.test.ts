import { afterEach, describe, expect, test } from "bun:test";
import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Hono } from "hono";
import type { AppContext } from "../src/app-context";
import type { ProviderConfig } from "../src/config/persisted-config";
import type { ControllerRuntime } from "../src/core/effect-runtime";
import { isHttpStatus } from "../src/core/errors";
import {
  controllerRuntimeMiddleware,
  type ControllerEnvironment,
} from "../src/http/effect-handler";
import { registerFoundryRoutes } from "../src/modules/foundry/routes";
import { ScientificWorkbenchStore } from "../src/modules/workbench/store";
import { createScientificRayJobRecord } from "../src/modules/workbench/service";
import type { ScientificRayJobSubmission } from "../contracts/scientific-workbench";

type FixtureMode = "healthy" | "malformed" | "oversized" | "slow";
type ObservedRequest = { path: string; body: unknown };

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const runtimes: ControllerRuntime[] = [];
const workbenchStores: ScientificWorkbenchStore[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
  for (const store of workbenchStores.splice(0)) await Effect.runPromise(store.close());
});

const principal = (overrides: Partial<NormalizedPrincipal> = {}): NormalizedPrincipal => ({
  subject: "scientist-1",
  issuer: "https://login.microsoftonline.com/tenant/v2.0",
  issuer_id: "entra",
  tenant: "tenant",
  display_name: "Scientist",
  roles: ["scientist"],
  entitlements: ["model:invoke", "agent:invoke"],
  clearance: "C2",
  issued_at: 1,
  expires_at: 4_102_444_800,
  ...overrides,
});

const delegatedToken = [
  Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(
    JSON.stringify({
      sub: "scientist-1",
      iss: "https://login.microsoftonline.com/tenant/v2.0",
      aud: "api://local-studio",
      scp: "api://local-studio/invoke",
      exp: 4_102_444_800,
    }),
  ).toString("base64url"),
  "fixture-signature",
].join(".");

const provider = (gateway: string): ProviderConfig => ({
  id: "foundry",
  name: "Foundry",
  base_url: gateway,
  enabled: true,
  authentication: {
    type: "apim_gateway",
    issuer_id: "entra",
    audience: "api://local-studio",
    scopes: ["api://local-studio/invoke"],
  },
  foundry: {
    provider_id: "foundry",
    gateway_url: gateway,
    project_endpoint: "https://resource.services.ai.azure.com/api/projects/project",
    project_name: "project",
    allowed_models: ["model-admitted", "model-slow"],
    allowed_agents: ["agent-admitted"],
    authentication: {
      type: "apim_gateway",
      issuer_id: "entra",
      audience: "api://local-studio",
      scopes: ["api://local-studio/invoke"],
    },
  },
});

const scientificSubmission = (): ScientificRayJobSubmission => ({
  id: "submission-01",
  project_id: "project-01",
  notebook_id: "notebook-01",
  compute_lease_id: "lease-01",
  experiment_id: "experiment-01",
  classification: "C2",
  compute_profile: {
    id: "cpu-small",
    name: "CPU small",
    cpu_cores: 2,
    memory_gb: 4,
    gpu_count: 0,
    gpu_resource: null,
    min_workers: 0,
    max_workers: 1,
    max_runtime_minutes: 30,
    idle_timeout_minutes: 5,
    network_policy: "deny-by-default",
    classification_ceiling: "C2",
  },
  environment_image: `registry.example.test/science@sha256:${"a".repeat(64)}`,
  environment_digest: `sha256:${"a".repeat(64)}`,
  entrypoint: "python main.py",
  datasets: [],
  models: [
    {
      provider_id: "foundry",
      model_id: "model-admitted",
      qualified_id: "foundry/model-admitted",
      endpoint_class: "openai-compatible",
      tool_mode: "approved",
    },
  ],
  parameters: {},
  random_seeds: [42],
  approval_ids: ["approval-01"],
  requested_by: "scientist-1",
  requested_at: "2026-07-29T00:00:00.000Z",
});

const makeGateway = () => {
  let mode: FixtureMode = "healthy";
  let aborted = false;
  const observed: ObservedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      expect(request.headers.get("authorization")).toBe(`Bearer ${delegatedToken}`);
      const path = new URL(request.url).pathname;
      const body =
        request.method === "POST"
          ? await request
              .clone()
              .json()
              .catch(() => null)
          : null;
      observed.push({ path, body });
      if (path === "/ai/v1/models") {
        if (mode === "malformed") return Response.json({ results: [] });
        if (mode === "oversized") {
          return Response.json({
            data: [{ id: `model-${"x".repeat(2 * 1024 * 1024)}` }],
          });
        }
        return Response.json(
          {
            data: [
              { id: "model-admitted", object: "model" },
              { id: "model-denied", object: "model" },
            ],
          },
          { headers: { "x-correlation-id": "models-correlation" } },
        );
      }
      if (path === "/ai/v1/agents") {
        return Response.json(
          {
            data: [
              { id: "agent-admitted", object: "agent" },
              { id: "agent-denied", object: "agent" },
            ],
          },
          { headers: { "x-correlation-id": "agents-correlation" } },
        );
      }
      if (mode === "slow") {
        return new Promise<Response>((resolve) => {
          request.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve(new Response(null, { status: 499 }));
            },
            { once: true },
          );
        });
      }
      if (path === "/ai/v1/chat/completions") {
        return Response.json(
          { id: "chat-1", choices: [{ message: { content: "fixture" } }] },
          {
            headers: {
              "x-correlation-id": "chat-correlation",
              "x-ms-input-tokens": "5",
              "x-ms-output-tokens": "3",
              "x-ms-total-tokens": "8",
            },
          },
        );
      }
      if (path === "/ai/v1/responses") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"type":"response.output_text.delta"}\n\n'),
            );
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "x-correlation-id": "stream-correlation",
          },
        });
      }
      if (path === "/ai/v1/agents/agent-admitted/invoke") {
        return Response.json(
          { id: "agent-response-1", output: [{ type: "message" }] },
          { headers: { "x-correlation-id": "agent-correlation" } },
        );
      }
      return Response.json({ error: "fixture route not found" }, { status: 404 });
    },
  });
  servers.push(server);
  return {
    url: `http://127.0.0.1:${server.port}`,
    observed,
    setMode: (value: FixtureMode) => {
      mode = value;
    },
    wasAborted: () => aborted,
  };
};

const makeController = (gateway: string, principals: Record<string, NormalizedPrincipal>) => {
  const runtime = ManagedRuntime.make(Layer.empty) as unknown as ControllerRuntime;
  runtimes.push(runtime);
  const scientificWorkbenchStore = new ScientificWorkbenchStore(":memory:");
  workbenchStores.push(scientificWorkbenchStore);
  const context = {
    config: {
      providers: [provider(gateway)],
      enterprise_auth: {
        mode: "required_oidc",
        session_idle_seconds: 900,
        session_absolute_seconds: 3600,
        issuers: [
          {
            id: "entra",
            kind: "entra",
            issuer: "https://login.microsoftonline.com/tenant/v2.0",
            client_id: "client",
            audience: "api://local-studio",
            scopes: ["api://local-studio/invoke"],
            tenant: "tenant",
            role_claim: "roles",
            group_claim: "groups",
            role_mappings: {},
            clearance_mappings: {},
          },
        ],
      },
    },
    stores: { scientificWorkbenchStore },
  } as unknown as AppContext;
  const app = new Hono<ControllerEnvironment>();
  app.use("*", controllerRuntimeMiddleware(runtime));
  app.use("*", async (ctx, next) => {
    const selected = principals[ctx.req.header("x-fixture-principal") ?? "valid"];
    if (selected) {
      ctx.set("enterprisePrincipal", selected);
      ctx.set("enterpriseBearerToken", delegatedToken);
    }
    await next();
  });
  registerFoundryRoutes(app, context);
  app.onError((error, ctx) =>
    isHttpStatus(error)
      ? ctx.json({ detail: error.detail }, error.status as 400 | 403 | 404 | 413 | 503)
      : ctx.json({ detail: "Internal Server Error" }, 500),
  );
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  servers.push(server);
  return {
    base: `http://127.0.0.1:${server.port}`,
    scientificWorkbenchStore,
  };
};

const request = (base: string, path: string, init: RequestInit = {}, selected = "valid") =>
  fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${delegatedToken}`,
      "x-fixture-principal": selected,
      ...init.headers,
    },
  });

describe("Foundry HTTP integration", () => {
  test("filters both catalogs and reports observed health with exact correlations", async () => {
    const gateway = makeGateway();
    const { base } = makeController(gateway.url, { valid: principal() });
    const models = await request(base, "/ai/v1/models");
    const agents = await request(base, "/ai/v1/agents");
    const health = await request(base, "/ai/v1/health");
    expect(models.status).toBe(200);
    expect(agents.status).toBe(200);
    expect(health.status).toBe(200);
    expect(
      ((await models.json()) as { data: Array<{ id: string }> }).data.map(({ id }) => id),
    ).toEqual(["model-admitted"]);
    expect(
      ((await agents.json()) as { data: Array<{ id: string }> }).data.map(({ id }) => id),
    ).toEqual(["agent-admitted"]);
    expect(await health.json()).toMatchObject({
      configured: true,
      required: true,
      state: "observed",
      correlation_ids: ["models-correlation", "agents-correlation"],
      model_count: 1,
      agent_count: 1,
    });
  });

  test("fails closed for missing, wrong-tenant, low-clearance, and unentitled principals", async () => {
    const gateway = makeGateway();
    const { base } = makeController(gateway.url, {
      wrongTenant: principal({ tenant: "other" }),
      lowClearance: principal({ clearance: "C1" }),
      unentitled: principal({ entitlements: ["model:invoke"] }),
    });
    for (const selected of ["missing", "wrongTenant", "lowClearance", "unentitled"]) {
      const response = await request(base, "/ai/v1/agents", {}, selected);
      expect(response.status).toBe(403);
    }
    expect(gateway.observed).toHaveLength(0);
  });

  test("rejects denied resources and malformed or oversized catalogs", async () => {
    const gateway = makeGateway();
    const { base } = makeController(gateway.url, { valid: principal() });
    const deniedModel = await request(base, "/ai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "model-denied", messages: [] }),
    });
    const deniedAgent = await request(base, "/ai/v1/agents/agent-denied/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });
    expect(deniedModel.status).toBe(400);
    expect(deniedAgent.status).toBe(400);
    expect(gateway.observed).toHaveLength(0);
    gateway.setMode("malformed");
    expect((await request(base, "/ai/v1/models")).status).toBe(503);
    gateway.setMode("oversized");
    expect((await request(base, "/ai/v1/models")).status).toBe(503);
  });

  test("relays model and agent payloads, SSE, correlation, usage evidence, and cancellation", async () => {
    const gateway = makeGateway();
    const { base, scientificWorkbenchStore } = makeController(gateway.url, {
      valid: principal(),
      otherSubject: principal({ subject: "scientist-2" }),
    });
    const submission = scientificSubmission();
    await Effect.runPromise(
      scientificWorkbenchStore.saveRayJob(
        submission,
        createScientificRayJobRecord(submission, "2026-07-29T00:00:01.000Z", principal()),
      ),
    );
    const evidence: string[] = [];
    const originalInfo = console.info;
    console.info = (line?: unknown) => evidence.push(String(line));
    try {
      const mismatchedModel = await request(base, "/ai/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-studio-scientific-submission-id": submission.id,
        },
        body: JSON.stringify({ model: "model-slow", input: "forged link" }),
      });
      expect(mismatchedModel.status).toBe(400);
      expect(gateway.observed).toHaveLength(0);
      const chat = await request(base, "/ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-studio-scientific-submission-id": submission.id,
        },
        body: JSON.stringify({
          model: "model-admitted",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(chat.status).toBe(200);
      expect(chat.headers.get("x-correlation-id")).toBe("chat-correlation");
      expect(chat.headers.get("x-ms-total-tokens")).toBe("8");
      const stream = await request(base, "/ai/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "model-admitted", input: "hi", stream: true }),
      });
      expect(stream.headers.get("content-type")).toContain("text/event-stream");
      expect(await stream.text()).toContain("data: [DONE]");
      const agent = await request(base, "/ai/v1/agents/agent-admitted/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-studio-scientific-submission-id": submission.id,
        },
        body: JSON.stringify({ input: "summarize", conversation_id: "conversation-1" }),
      });
      expect(agent.status).toBe(200);
      expect(agent.headers.get("x-correlation-id")).toBe("agent-correlation");
      expect(gateway.observed).toContainEqual({
        path: "/ai/v1/agents/agent-admitted/invoke",
        body: { input: "summarize", conversation_id: "conversation-1" },
      });
      expect(
        await Effect.runPromise(
          scientificWorkbenchStore.listFoundryInvocationEvidence(submission.id),
        ),
      ).toEqual([
        expect.objectContaining({
          submission_id: submission.id,
          kind: "model",
          resource_id: "model-admitted",
          correlation_id: "chat-correlation",
          principal: expect.objectContaining({
            subject: "scientist-1",
            issuer: "https://login.microsoftonline.com/tenant/v2.0",
            tenant: "tenant",
          }),
        }),
        expect.objectContaining({
          submission_id: submission.id,
          kind: "agent",
          resource_id: "agent-admitted",
          correlation_id: "agent-correlation",
        }),
      ]);
      const forgedLink = await request(
        base,
        "/ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-local-studio-scientific-submission-id": submission.id,
          },
          body: JSON.stringify({ model: "model-admitted", messages: [] }),
        },
        "otherSubject",
      );
      expect(forgedLink.status).toBe(403);
      const parsedEvidence = evidence.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(parsedEvidence).toContainEqual(
        expect.objectContaining({
          event: "model_invocation",
          correlation_id: "chat-correlation",
          resource_id: "model-admitted",
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
          subject: "scientist-1",
          issuer: "https://login.microsoftonline.com/tenant/v2.0",
          tenant: "tenant",
          clearance: "C2",
        }),
      );

      gateway.setMode("slow");
      const abort = new AbortController();
      const pending = request(base, "/ai/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "model-slow", input: "wait" }),
        signal: abort.signal,
      });
      await Bun.sleep(20);
      abort.abort();
      await expect(pending).rejects.toThrow();
      for (let index = 0; index < 20 && !gateway.wasAborted(); index += 1) await Bun.sleep(5);
      expect(gateway.wasAborted()).toBe(true);
    } finally {
      console.info = originalInfo;
    }
  });
});
