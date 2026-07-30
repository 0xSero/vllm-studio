import { Effect, Schema } from "effect";
import type {
  EnterpriseEntitlement,
  NormalizedPrincipal,
} from "@local-studio/contracts/enterprise-auth";
import type { AppContext } from "../../app-context";
import type { ProviderConfig } from "../../config/persisted-config";
import { badRequest, forbidden } from "../../core/errors";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { effectHandler } from "../../http/effect-handler";
import { resolveProviderHeaders } from "../../services/provider-authentication";
import {
  bearerToken,
  enforceFoundryPrincipal,
  fetchFoundryCatalog,
  readFoundryRequest,
  requestFoundryGateway,
  selectFoundryProvider,
  usageFromHeaders,
} from "./adapter";
import { emitFoundryEvidence } from "./evidence";
import {
  resolveScientificEvidenceLink,
  saveScientificFoundryEvidence,
  type FoundryInvocationKind,
} from "./scientific-evidence";

const AgentInvokeSchema = Schema.Struct({
  input: Schema.Unknown,
  conversation_id: Schema.optional(Schema.String),
});

const ModelRequestSchema = Schema.Record(Schema.String, Schema.Unknown);

type AuthorizedRequest = {
  provider: ProviderConfig;
  principal: NormalizedPrincipal;
  token: string;
};

const authorize = (
  context: AppContext,
  principal: NormalizedPrincipal | undefined,
  verifiedToken: string | undefined,
  requested: string | undefined,
  entitlements: readonly [EnterpriseEntitlement, ...EnterpriseEntitlement[]],
): Effect.Effect<AuthorizedRequest, unknown> => {
  const provider = selectFoundryProvider(context.config.providers, requested);
  let validatedPrincipal = enforceFoundryPrincipal(
    provider,
    principal,
    context.config.enterprise_auth,
    entitlements[0],
  );
  for (const entitlement of entitlements.slice(1)) {
    validatedPrincipal = enforceFoundryPrincipal(
      provider,
      validatedPrincipal,
      context.config.enterprise_auth,
      entitlement,
    );
  }
  const token = verifiedToken ?? "";
  return resolveProviderHeaders(
    {
      ...provider,
      authentication: provider.foundry!.authentication,
    },
    {
      secretStore: context.providerSecretStore,
      principal: validatedPrincipal,
      verifiedBearerToken: token,
    },
  ).pipe(
    Effect.mapError(() => forbidden("Foundry token contract denied")),
    Effect.map((headers) => ({
      provider,
      principal: validatedPrincipal,
      token: bearerToken(headers["Authorization"]),
    })),
  );
};

const responseHeaders = (upstream: Headers, correlationId: string): Headers => {
  const headers = new Headers({ "X-Correlation-ID": correlationId });
  for (const name of [
    "content-type",
    "cache-control",
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ms-input-tokens",
    "x-ms-output-tokens",
    "x-ms-total-tokens",
  ]) {
    const value = upstream.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
};

type RelayInput = {
  path: string;
  operation: string;
  body: unknown;
  signal: AbortSignal;
  resourceId: string;
  event: FoundryInvocationKind;
  scientificSubmissionId?: string | undefined;
};

const gatewayRequest = (
  request: AuthorizedRequest,
  input: RelayInput,
): Effect.Effect<{ response: Response; correlationId: string }, unknown> =>
  requestFoundryGateway({
    provider: request.provider,
    path: input.path,
    token: request.token,
    method: "POST",
    body: JSON.stringify(input.body),
    signal: input.signal,
    accept:
      input.body &&
      typeof input.body === "object" &&
      (input.body as Record<string, unknown>)["stream"] === true
        ? "text/event-stream"
        : "application/json",
  });

const relay = (
  context: AppContext,
  request: AuthorizedRequest,
  input: RelayInput,
): Effect.Effect<Response, unknown> =>
  Effect.gen(function* () {
    const linkedSubmissionId = yield* resolveScientificEvidenceLink(
      context,
      request.principal,
      request.provider.id,
      input.resourceId,
      input.event,
      input.scientificSubmissionId,
    );
    const result = yield* gatewayRequest(request, input);
    const usage = usageFromHeaders(result.response.headers);
    if (linkedSubmissionId) {
      yield* saveScientificFoundryEvidence(context, {
        submissionId: linkedSubmissionId,
        principal: request.principal,
        providerId: request.provider.id,
        resourceId: input.resourceId,
        correlationId: result.correlationId,
        event: input.event,
        upstreamBody: result.response.body,
      });
    }
    emitFoundryEvidence({
      event: input.event,
      principal: request.principal,
      operation: input.operation,
      correlation_id: result.correlationId,
      provider_id: request.provider.id,
      resource_id: input.resourceId,
      status: result.response.status,
      ...(usage ? { usage } : {}),
    });
    return new Response(result.response.body, {
      status: result.response.status,
      headers: responseHeaders(result.response.headers, result.correlationId),
    });
  });

export const registerFoundryRoutes = defineRoutes((app, context) =>
  mergeRoutes(
    app.get(
      "/ai/v1/health",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const configured = context.config.providers.filter(
            (provider) => provider.enabled && provider.foundry,
          );
          if (configured.length === 0) {
            return ctx.json({
              configured: false,
              required: false,
              state: "claimed",
              detail: "Microsoft Foundry is not configured.",
              correlation_ids: [],
              model_count: 0,
              agent_count: 0,
            });
          }
          const request = yield* authorize(
            context,
            ctx.get("enterprisePrincipal"),
            ctx.get("enterpriseBearerToken"),
            ctx.req.query("provider"),
            ["model:invoke", "agent:invoke"],
          );
          const [models, agents] = yield* Effect.all(
            [
              fetchFoundryCatalog(request.provider, request.token, "models", ctx.req.raw.signal),
              fetchFoundryCatalog(request.provider, request.token, "agents", ctx.req.raw.signal),
            ],
            { concurrency: 2 },
          );
          emitFoundryEvidence({
            event: "catalog_observed",
            principal: request.principal,
            operation: "health",
            correlation_id: `${models.correlation_id},${agents.correlation_id}`,
            provider_id: request.provider.id,
            status: 200,
          });
          return ctx.json({
            configured: true,
            required: true,
            state: "observed",
            detail: "APIM model and agent catalogs were observed.",
            provider_id: request.provider.id,
            correlation_ids: [models.correlation_id, agents.correlation_id],
            checked_at: new Date().toISOString(),
            model_count: models.data.length,
            agent_count: agents.data.length,
          });
        }),
      ),
    ),
    app.get(
      "/ai/v1/models",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const request = yield* authorize(
            context,
            ctx.get("enterprisePrincipal"),
            ctx.get("enterpriseBearerToken"),
            ctx.req.query("provider"),
            ["model:invoke"],
          );
          const catalog = yield* fetchFoundryCatalog(
            request.provider,
            request.token,
            "models",
            ctx.req.raw.signal,
          );
          emitFoundryEvidence({
            event: "catalog_observed",
            principal: request.principal,
            operation: "models.list",
            correlation_id: catalog.correlation_id,
            provider_id: request.provider.id,
            status: 200,
          });
          return ctx.json(catalog);
        }),
      ),
    ),
    app.post(
      "/ai/v1/chat/completions",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const request = yield* authorize(
            context,
            ctx.get("enterprisePrincipal"),
            ctx.get("enterpriseBearerToken"),
            ctx.req.query("provider"),
            ["model:invoke"],
          );
          const body = yield* readFoundryRequest(ctx.req.raw, ModelRequestSchema);
          const model = typeof body["model"] === "string" ? body["model"] : "";
          if (!request.provider.foundry!.allowed_models.includes(model)) {
            return yield* Effect.fail(badRequest(`Model "${model}" is not allowed`));
          }
          return yield* relay(context, request, {
            path: "/ai/v1/chat/completions",
            operation: "chat.completions",
            body,
            signal: ctx.req.raw.signal,
            resourceId: model,
            event: "model_invocation",
            scientificSubmissionId: ctx.req.header("x-local-studio-scientific-submission-id"),
          });
        }),
      ),
    ),
    app.post(
      "/ai/v1/responses",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const request = yield* authorize(
            context,
            ctx.get("enterprisePrincipal"),
            ctx.get("enterpriseBearerToken"),
            ctx.req.query("provider"),
            ["model:invoke"],
          );
          const body = yield* readFoundryRequest(ctx.req.raw, ModelRequestSchema);
          const model = typeof body["model"] === "string" ? body["model"] : "";
          if (!request.provider.foundry!.allowed_models.includes(model)) {
            return yield* Effect.fail(badRequest(`Model "${model}" is not allowed`));
          }
          return yield* relay(context, request, {
            path: "/ai/v1/responses",
            operation: "responses.create",
            body,
            signal: ctx.req.raw.signal,
            resourceId: model,
            event: "model_invocation",
            scientificSubmissionId: ctx.req.header("x-local-studio-scientific-submission-id"),
          });
        }),
      ),
    ),
    app.get(
      "/ai/v1/agents",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const request = yield* authorize(
            context,
            ctx.get("enterprisePrincipal"),
            ctx.get("enterpriseBearerToken"),
            ctx.req.query("provider"),
            ["agent:invoke"],
          );
          const catalog = yield* fetchFoundryCatalog(
            request.provider,
            request.token,
            "agents",
            ctx.req.raw.signal,
          );
          emitFoundryEvidence({
            event: "catalog_observed",
            principal: request.principal,
            operation: "agents.list",
            correlation_id: catalog.correlation_id,
            provider_id: request.provider.id,
            status: 200,
          });
          return ctx.json(catalog);
        }),
      ),
    ),
    app.post(
      "/ai/v1/agents/:agentId/invoke",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const request = yield* authorize(
            context,
            ctx.get("enterprisePrincipal"),
            ctx.get("enterpriseBearerToken"),
            ctx.req.query("provider"),
            ["agent:invoke"],
          );
          const agentId = ctx.req.param("agentId") ?? "";
          if (!request.provider.foundry!.allowed_agents.includes(agentId)) {
            return yield* Effect.fail(badRequest(`Agent "${agentId}" is not allowed`));
          }
          const body = yield* readFoundryRequest(ctx.req.raw, AgentInvokeSchema);
          return yield* relay(context, request, {
            path: `/ai/v1/agents/${encodeURIComponent(agentId)}/invoke`,
            operation: "agent.invoke",
            body,
            signal: ctx.req.raw.signal,
            resourceId: agentId,
            event: "agent_invocation",
            scientificSubmissionId: ctx.req.header("x-local-studio-scientific-submission-id"),
          });
        }),
      ),
    ),
  ),
);
