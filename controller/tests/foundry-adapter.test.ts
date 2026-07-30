import { afterEach, describe, expect, test } from "bun:test";
import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import { Effect, Schema } from "effect";
import type { ProviderConfig } from "../src/config/persisted-config";
import { HttpStatus } from "../src/core/errors";
import {
  FOUNDRY_REQUEST_LIMIT_BYTES,
  enforceFoundryPrincipal,
  fetchFoundryCatalog,
  readFoundryRequest,
  requestFoundryGateway,
  usageFromHeaders,
} from "../src/modules/foundry/adapter";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

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
    allowed_models: ["model-admitted"],
    allowed_agents: ["agent-admitted"],
    authentication: {
      type: "apim_gateway",
      issuer_id: "entra",
      audience: "api://local-studio",
      scopes: ["api://local-studio/invoke"],
    },
  },
});

const principal = (overrides: Partial<NormalizedPrincipal> = {}): NormalizedPrincipal => ({
  subject: "subject-1",
  issuer: "https://login.microsoftonline.com/tenant/v2.0",
  issuer_id: "entra",
  tenant: "tenant",
  display_name: "Scientist",
  roles: ["scientist"],
  entitlements: ["notebook:read", "notebook:execute", "ray:admit", "model:invoke", "agent:invoke"],
  clearance: "C2",
  issued_at: 1,
  expires_at: 2,
  ...overrides,
});

const enterprise = {
  mode: "required_oidc" as const,
  session_idle_seconds: 900,
  session_absolute_seconds: 3600,
  issuers: [
    {
      id: "entra",
      kind: "entra" as const,
      issuer: "https://login.microsoftonline.com/tenant/v2.0",
      client_id: "client",
      audience: "api://local-studio",
      scopes: ["api://local-studio/invoke"],
      tenant: "tenant",
      role_claim: "roles",
      group_claim: "groups",
      role_mappings: { Scientist: ["scientist" as const] },
      clearance_mappings: { C2: "C2" as const },
    },
  ],
};

describe("Foundry adapter", () => {
  test("intersects live catalogs with the deployment allowlist and preserves correlation", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        expect(request.headers.get("authorization")).toBe("Bearer delegated-token");
        return Response.json(
          {
            data: [
              { id: "model-admitted", object: "model" },
              { id: "model-denied", object: "model" },
            ],
          },
          { headers: { "x-correlation-id": "apim-correlation" } },
        );
      },
    });
    servers.push(server);
    const catalog = await Effect.runPromise(
      fetchFoundryCatalog(provider(`http://127.0.0.1:${server.port}`), "delegated-token", "models"),
    );
    expect(catalog.data.map(({ id }) => id)).toEqual(["model-admitted"]);
    expect(catalog.correlation_id).toBe("apim-correlation");
    expect(catalog.provider_id).toBe("foundry");
  });

  test("replaces malformed upstream correlation identifiers", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json(
          { data: [{ id: "model-admitted", object: "model" }] },
          { headers: { "x-correlation-id": "../../forged" } },
        ),
    });
    servers.push(server);
    const catalog = await Effect.runPromise(
      fetchFoundryCatalog(provider(`http://127.0.0.1:${server.port}`), "delegated-token", "models"),
    );
    expect(catalog.correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  test("fails closed on issuer, tenant, clearance, entitlement, and auth mode", () => {
    const configured = provider("https://gateway.example");
    expect(
      enforceFoundryPrincipal(configured, principal(), enterprise, "model:invoke").subject,
    ).toBe("subject-1");
    for (const candidate of [
      principal({ issuer_id: "keycloak" }),
      principal({ tenant: "other" }),
      principal({ clearance: "C1" }),
      principal({ entitlements: ["notebook:read"] }),
    ]) {
      expect(() =>
        enforceFoundryPrincipal(configured, candidate, enterprise, "model:invoke"),
      ).toThrow();
    }
    expect(() =>
      enforceFoundryPrincipal(
        { ...configured, foundry: { ...configured.foundry!, authentication: { type: "none" } } },
        principal(),
        enterprise,
        "model:invoke",
      ),
    ).toThrow();
  });

  test("bounds JSON request bodies before parsing", async () => {
    const request = new Request("http://localhost/ai/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "x".repeat(FOUNDRY_REQUEST_LIMIT_BYTES) }),
    });
    const error = await Effect.runPromise(
      Effect.flip(readFoundryRequest(request, Schema.Record(Schema.String, Schema.Unknown))),
    );
    expect(error.status).toBe(413);
  });

  test("propagates client cancellation and maps APIM quota without response content", async () => {
    let aborted = false;
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname === "/quota") {
          return new Response("sensitive backend detail", { status: 429 });
        }
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
      },
    });
    servers.push(server);
    const configured = provider(`http://127.0.0.1:${server.port}`);
    const quota = await Effect.runPromise(
      Effect.flip(
        requestFoundryGateway({
          provider: configured,
          path: "/quota",
          token: "delegated-token",
        }),
      ),
    );
    expect(quota).toBeInstanceOf(HttpStatus);
    expect((quota as HttpStatus).status).toBe(429);
    expect((quota as HttpStatus).detail).toBe("APIM quota exceeded");
    expect(JSON.stringify(quota)).not.toContain("sensitive backend detail");
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(
      requestFoundryGateway({
        provider: configured,
        path: "/slow",
        token: "delegated-token",
        signal: controller.signal,
      }),
    );
    await Bun.sleep(20);
    controller.abort();
    expect((await pending)._tag).toBe("Failure");
    for (let index = 0; index < 20 && !aborted; index += 1) await Bun.sleep(5);
    expect(aborted).toBe(true);
  });

  test("records usage only when APIM returns token metrics", () => {
    expect(usageFromHeaders(new Headers())).toBeUndefined();
    expect(
      usageFromHeaders(
        new Headers({
          "x-ms-input-tokens": "12",
          "x-ms-output-tokens": "8",
          "x-ms-total-tokens": "20",
        }),
      ),
    ).toEqual({ input_tokens: 12, output_tokens: 8, total_tokens: 20 });
  });
});
