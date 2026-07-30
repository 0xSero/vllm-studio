import { randomUUID } from "node:crypto";
import type {
  EnterpriseAuthConfig,
  EnterpriseEntitlement,
  NormalizedPrincipal,
} from "@local-studio/contracts/enterprise-auth";
import {
  FoundryCatalogSchema,
  type FoundryCatalogView,
  type FoundryUsage,
} from "@local-studio/contracts/foundry";
import { Effect, Schema, Stream } from "effect";
import type { ProviderConfig } from "../../config/persisted-config";
import { HttpStatus, badRequest, forbidden, notFound, serviceUnavailable } from "../../core/errors";
import { hasEntitlement } from "../../http/enterprise-auth";
import { readBoundedRequestBody, RequestBodyTooLargeError } from "../../http/bounded-body";

export const FOUNDRY_REQUEST_LIMIT_BYTES = 1024 * 1024;
export const FOUNDRY_CATALOG_LIMIT_BYTES = 2 * 1024 * 1024;

const clearanceRank = { open: 0, internal: 1, C1: 2, C2: 3 } as const;

type FoundryRequest = {
  provider: ProviderConfig;
  path: string;
  token: string;
  method?: string;
  body?: string;
  signal?: AbortSignal;
  correlationId?: string;
  accept?: string;
};

export const selectFoundryProvider = (
  providers: readonly ProviderConfig[],
  requested?: string,
): ProviderConfig => {
  const candidates = providers.filter((provider) => provider.enabled && provider.foundry);
  const provider = requested
    ? candidates.find((candidate) => candidate.id === requested)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (!provider) {
    throw notFound(
      requested
        ? "Microsoft Foundry connection not found"
        : "Select exactly one configured Microsoft Foundry connection",
    );
  }
  return provider;
};

export const enforceFoundryPrincipal = (
  provider: ProviderConfig,
  principal: NormalizedPrincipal | undefined,
  enterprise: EnterpriseAuthConfig | undefined,
  entitlement: EnterpriseEntitlement,
): NormalizedPrincipal => {
  if (!principal) throw forbidden("Validated enterprise identity is required for Foundry");
  if (!hasEntitlement(principal, entitlement)) {
    throw forbidden(`${entitlement} entitlement is required`);
  }
  if (clearanceRank[principal.clearance] < clearanceRank.C2) {
    throw forbidden("C2 clearance is required for Foundry");
  }
  const authentication = provider.foundry?.authentication;
  if (authentication?.type !== "apim_gateway") {
    throw forbidden("Foundry connection must use APIM gateway authentication");
  }
  if (authentication.issuer_id !== principal.issuer_id) {
    throw forbidden("Foundry connection does not admit this issuer");
  }
  const issuer = enterprise?.issuers.find((candidate) => candidate.id === principal.issuer_id);
  const expectedTenant = issuer?.tenant ?? issuer?.realm;
  if (!expectedTenant || principal.tenant !== expectedTenant) {
    throw forbidden("Foundry connection does not admit this tenant");
  }
  return principal;
};

export const bearerToken = (header: string | undefined): string => {
  const match = header?.match(/^Bearer\s+(.+)$/iu);
  if (!match?.[1]) throw forbidden("Enterprise bearer token required");
  return match[1];
};

const boundedResponseText = (response: Response, limit: number): Effect.Effect<string, unknown> => {
  if (!response.body) return Effect.succeed("");
  return Stream.fromReadableStream({
    evaluate: () => response.body!,
    onError: (error) => error,
  }).pipe(
    Stream.runFoldEffect(
      () => ({ size: 0, chunks: [] as Uint8Array[] }),
      (state, chunk) => {
        const size = state.size + chunk.byteLength;
        return size > limit
          ? Effect.fail(serviceUnavailable("APIM catalog exceeded the response limit"))
          : Effect.succeed({ size, chunks: [...state.chunks, chunk] });
      },
    ),
    Effect.map(({ chunks }) =>
      new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))),
    ),
  );
};

const gatewayFailure = (status: number): HttpStatus => {
  if (status === 401) return new HttpStatus({ status: 401, detail: "APIM authentication failed" });
  if (status === 403) return forbidden("APIM authorization denied");
  if (status === 413) return new HttpStatus({ status: 413, detail: "APIM request limit exceeded" });
  if (status === 429) return new HttpStatus({ status: 429, detail: "APIM quota exceeded" });
  return serviceUnavailable(`APIM gateway returned ${status}`);
};

export const requestFoundryGateway = (
  request: FoundryRequest,
): Effect.Effect<{ response: Response; correlationId: string }, unknown> =>
  Effect.tryPromise({
    try: async () => {
      const gateway = request.provider.foundry!.gateway_url.replace(/\/+$/u, "");
      const correlationId = request.correlationId ?? randomUUID();
      const response = await fetch(`${gateway}${request.path}`, {
        method: request.method ?? "GET",
        headers: {
          Accept: request.accept ?? "application/json",
          Authorization: `Bearer ${request.token}`,
          "Content-Type": "application/json",
          "X-Correlation-ID": correlationId,
        },
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "manual",
        signal: request.signal ?? AbortSignal.timeout(30_000),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw serviceUnavailable("APIM gateway redirect denied");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw gatewayFailure(response.status);
      }
      const receivedCorrelationId = response.headers.get("x-correlation-id")?.trim() ?? "";
      return {
        response,
        correlationId: /^[A-Za-z0-9._:-]{1,256}$/u.test(receivedCorrelationId)
          ? receivedCorrelationId
          : correlationId,
      };
    },
    catch: (error) => error,
  });

export const readFoundryRequest = <A>(
  request: Request,
  schema: Schema.Codec<A, unknown, never, unknown>,
): Effect.Effect<A, HttpStatus> =>
  readBoundedRequestBody(request, FOUNDRY_REQUEST_LIMIT_BYTES).pipe(
    Effect.mapError((error) =>
      error instanceof RequestBodyTooLargeError
        ? new HttpStatus({ status: 413, detail: error.message })
        : badRequest("Invalid payload"),
    ),
    Effect.flatMap((body) =>
      Effect.try({
        try: () => JSON.parse(new TextDecoder().decode(body)) as unknown,
        catch: () => badRequest("Invalid payload"),
      }),
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError((error) =>
      error instanceof HttpStatus ? error : badRequest("Invalid payload"),
    ),
  );

export const fetchFoundryCatalog = (
  provider: ProviderConfig,
  token: string,
  kind: "models" | "agents",
  signal?: AbortSignal,
): Effect.Effect<FoundryCatalogView, unknown> =>
  Effect.gen(function* () {
    const result = yield* requestFoundryGateway({
      provider,
      path: `/ai/v1/${kind}`,
      token,
      ...(signal ? { signal } : {}),
    });
    const text = yield* boundedResponseText(result.response, FOUNDRY_CATALOG_LIMIT_BYTES);
    const decoded = yield* Schema.decodeUnknownEffect(FoundryCatalogSchema)(
      yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: () => serviceUnavailable(`APIM ${kind} catalog was not valid JSON`),
      }),
    ).pipe(Effect.mapError(() => serviceUnavailable(`APIM ${kind} catalog was malformed`)));
    const allowed = new Set(
      kind === "models" ? provider.foundry!.allowed_models : provider.foundry!.allowed_agents,
    );
    return {
      object: "list",
      data: decoded.data.filter((entry) => allowed.has(entry.id)),
      provider_id: provider.id,
      correlation_id: result.correlationId,
      observed_at: new Date().toISOString(),
    };
  });

export const usageFromHeaders = (headers: Headers): FoundryUsage | undefined => {
  const number = (name: string): number | undefined => {
    const raw = headers.get(name)?.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const usage = {
    input_tokens: number("x-ms-input-tokens"),
    output_tokens: number("x-ms-output-tokens"),
    total_tokens: number("x-ms-total-tokens"),
  };
  return Object.values(usage).some((value) => value !== undefined)
    ? {
        ...(usage.input_tokens === undefined ? {} : { input_tokens: usage.input_tokens }),
        ...(usage.output_tokens === undefined ? {} : { output_tokens: usage.output_tokens }),
        ...(usage.total_tokens === undefined ? {} : { total_tokens: usage.total_tokens }),
      }
    : undefined;
};
