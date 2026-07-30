import type {
  NormalizedPrincipal,
  ProviderAuthentication,
} from "@local-studio/contracts/enterprise-auth";
import { Deferred, Effect, Schema } from "effect";
import { decodeJwt } from "jose";
import type { ProviderConfig } from "../config/persisted-config";
import { providerApiKeyReference, type ProviderSecretStore } from "./provider-secret-store";
import { providerSecretReferenceMatches } from "./provider-secret-store";
import { clientCredentialsToken, exchangeProviderToken } from "./provider-token-exchange";

export class ProviderAuthenticationError extends Schema.TaggedErrorClass<ProviderAuthenticationError>()(
  "ProviderAuthenticationError",
  {
    provider: Schema.String,
    reason: Schema.Literals([
      "credential_unavailable",
      "identity_unavailable",
      "identity_mismatch",
      "token_unavailable",
      "token_invalid",
      "audience_mismatch",
      "scope_mismatch",
    ]),
  },
) {}

export type ProviderAuthenticationContext = {
  secretStore?: ProviderSecretStore | undefined;
  principal?: NormalizedPrincipal | undefined;
  verifiedBearerToken?: string | undefined;
  directApiKey?: string | undefined;
  directClientSecret?: string | undefined;
  directSubscriptionKey?: { header: string; value: string } | undefined;
  signal?: AbortSignal | undefined;
};

const ManagedIdentityResponseSchema = Schema.Struct({
  access_token: Schema.String,
  expires_on: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  expires_in: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
});

type CachedToken = { token: string; expiresAt: number };
const managedIdentityCache = new Map<string, CachedToken>();
const managedIdentityPending = new Map<
  string,
  Deferred.Deferred<CachedToken, ProviderAuthenticationError>
>();

const normalizedRequiredValue = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_048) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
};

export const normalizeProviderAuthentication = (
  providerId: string,
  authentication: ProviderAuthentication,
): ProviderAuthentication => {
  if (authentication.type === "none") return authentication;
  if (authentication.type === "api_key") {
    return {
      type: "api_key",
      secret_ref: providerSecretReferenceMatches(providerId, authentication.secret_ref, "api-key")
        ? authentication.secret_ref
        : providerApiKeyReference(providerId),
    };
  }
  if (authentication.type === "managed_identity") {
    const resource = normalizedRequiredValue(authentication.resource, "resource");
    const resourceUrl = new URL(resource);
    if (!["https:", "api:"].includes(resourceUrl.protocol)) {
      throw new TypeError("Managed identity resource is invalid");
    }
    return { type: "managed_identity", resource };
  }
  const issuerId = normalizedRequiredValue(authentication.issuer_id, "issuer_id");
  const audience = normalizedRequiredValue(authentication.audience, "audience");
  const scopes = [...new Set(authentication.scopes.map((scope) => scope.trim()).filter(Boolean))];
  if (scopes.length === 0 || scopes.some((scope) => scope.length > 2_048)) {
    throw new TypeError("Provider scopes are invalid");
  }
  if (authentication.type === "apim_client") {
    const tokenEndpoint = normalizedRequiredValue(authentication.token_endpoint, "token_endpoint");
    const endpoint = new URL(tokenEndpoint);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    ) {
      throw new TypeError("Token endpoint is invalid");
    }
    const clientId = normalizedRequiredValue(authentication.client_id, "client_id");
    if (
      authentication.client_secret_ref &&
      !providerSecretReferenceMatches(providerId, authentication.client_secret_ref, "client-secret")
    ) {
      throw new TypeError("Client secret reference is invalid");
    }
    return {
      type: "apim_client",
      issuer_id: issuerId,
      audience,
      scopes,
      token_endpoint: tokenEndpoint,
      client_id: clientId,
      ...(authentication.client_secret_ref
        ? { client_secret_ref: authentication.client_secret_ref }
        : {}),
    };
  }
  const tokenExchange = authentication.token_exchange;
  if (tokenExchange) {
    const endpoint = new URL(
      normalizedRequiredValue(tokenExchange.token_endpoint, "token_endpoint"),
    );
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    ) {
      throw new TypeError("Token exchange endpoint is invalid");
    }
    if (
      tokenExchange.client_secret_ref &&
      !providerSecretReferenceMatches(providerId, tokenExchange.client_secret_ref, "client-secret")
    ) {
      throw new TypeError("Token exchange client secret reference is invalid");
    }
  }
  return {
    type: authentication.type,
    issuer_id: issuerId,
    audience,
    scopes,
    ...(tokenExchange
      ? {
          token_exchange: {
            mode: tokenExchange.mode,
            token_endpoint: tokenExchange.token_endpoint,
            client_id: normalizedRequiredValue(tokenExchange.client_id, "client_id"),
            ...(tokenExchange.client_secret_ref
              ? { client_secret_ref: tokenExchange.client_secret_ref }
              : {}),
          },
        }
      : {}),
  };
};

const expiryTime = (value: typeof ManagedIdentityResponseSchema.Type): number => {
  const expiresOn = Number(value.expires_on);
  if (Number.isFinite(expiresOn) && expiresOn > Date.now() / 1000) return expiresOn * 1000;
  const expiresIn = Number(value.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) return Date.now() + expiresIn * 1000;
  return Date.now() + 5 * 60_000;
};

const managedIdentityEndpoint = (resource: string): URL => {
  const configured =
    process.env["LOCAL_STUDIO_MANAGED_IDENTITY_ENDPOINT"]?.trim() ||
    process.env["IDENTITY_ENDPOINT"]?.trim() ||
    "http://169.254.169.254/metadata/identity/oauth2/token";
  const url = new URL(configured);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Managed identity endpoint is invalid");
  }
  url.searchParams.set("api-version", "2018-02-01");
  url.searchParams.set("resource", resource);
  return url;
};

const acquireManagedIdentityToken = (
  provider: string,
  resource: string,
  signal?: AbortSignal,
): Effect.Effect<string, ProviderAuthenticationError> =>
  Effect.gen(function* () {
    const cached = managedIdentityCache.get(resource);
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
    let pending = managedIdentityPending.get(resource);
    if (!pending) {
      pending = Deferred.makeUnsafe<CachedToken, ProviderAuthenticationError>();
      managedIdentityPending.set(resource, pending);
      const shared = pending;
      yield* Effect.gen(function* () {
        const endpoint = managedIdentityEndpoint(resource);
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(endpoint, {
              headers: {
                Metadata: "true",
                ...(process.env["IDENTITY_HEADER"]?.trim()
                  ? { "X-IDENTITY-HEADER": process.env["IDENTITY_HEADER"]!.trim() }
                  : {}),
              },
              signal: AbortSignal.timeout(10_000),
              redirect: "error",
            }),
          catch: () =>
            new ProviderAuthenticationError({
              provider,
              reason: "identity_unavailable",
            }),
        });
        if (!response.ok) {
          return yield* Effect.fail(
            new ProviderAuthenticationError({
              provider,
              reason: "identity_unavailable",
            }),
          );
        }
        const payload = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () =>
            new ProviderAuthenticationError({
              provider,
              reason: "identity_unavailable",
            }),
        });
        const decoded = yield* Schema.decodeUnknownEffect(ManagedIdentityResponseSchema)(
          payload,
        ).pipe(
          Effect.mapError(
            () =>
              new ProviderAuthenticationError({
                provider,
                reason: "identity_unavailable",
              }),
          ),
        );
        const result = { token: decoded.access_token, expiresAt: expiryTime(decoded) };
        managedIdentityCache.set(resource, result);
        return result;
      }).pipe(
        Effect.tap((result) => Deferred.succeed(shared, result)),
        Effect.tapError((error) => Deferred.fail(shared, error)),
        Effect.ensuring(
          Effect.sync(() => {
            managedIdentityPending.delete(resource);
          }),
        ),
        Effect.forkDetach({ startImmediately: true }),
      );
    }
    const wait = Deferred.await(pending);
    const result = yield* signal
      ? Effect.raceFirst(
          wait,
          Effect.callback<CachedToken, ProviderAuthenticationError>((resume) => {
            const abort = (): void =>
              resume(
                Effect.fail(
                  new ProviderAuthenticationError({
                    provider,
                    reason: "identity_unavailable",
                  }),
                ),
              );
            if (signal.aborted) {
              abort();
              return;
            }
            signal.addEventListener("abort", abort, { once: true });
            return Effect.sync(() => signal.removeEventListener("abort", abort));
          }),
        )
      : wait;
    return result.token;
  });

const validateClientCredentialsToken = (
  provider: string,
  authentication: Extract<ProviderAuthentication, { type: "apim_client" }>,
  token: string,
): Effect.Effect<string, ProviderAuthenticationError> =>
  Effect.try({
    try: () => decodeJwt(token),
    catch: () => new ProviderAuthenticationError({ provider, reason: "token_invalid" }),
  }).pipe(
    Effect.flatMap((payload) => {
      const audiences =
        typeof payload.aud === "string"
          ? [payload.aud]
          : Array.isArray(payload.aud)
            ? payload.aud
            : [];
      const scopes = new Set(
        [
          ...(typeof payload["scp"] === "string" ? payload["scp"].split(/\s+/u) : []),
          ...(typeof payload["scope"] === "string" ? payload["scope"].split(/\s+/u) : []),
        ].filter(Boolean),
      );
      if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
        return Effect.fail(new ProviderAuthenticationError({ provider, reason: "token_invalid" }));
      }
      if (!audiences.includes(authentication.audience)) {
        return Effect.fail(
          new ProviderAuthenticationError({ provider, reason: "audience_mismatch" }),
        );
      }
      if (!authentication.scopes.every((scope) => scopes.has(scope))) {
        return Effect.fail(
          new ProviderAuthenticationError({ provider, reason: "scope_mismatch" }),
        );
      }
      return Effect.succeed(token);
    }),
  );

const validatedDelegatedToken = (
  provider: string,
  authentication: Extract<ProviderAuthentication, { type: "oidc_user" | "apim_gateway" }>,
  principal: NormalizedPrincipal,
  token: string,
): Effect.Effect<string, ProviderAuthenticationError> =>
  Effect.try({
    try: () => decodeJwt(token),
    catch: () => new ProviderAuthenticationError({ provider, reason: "token_invalid" }),
  }).pipe(
    Effect.flatMap((payload) => {
      const audiences =
        typeof payload.aud === "string"
          ? [payload.aud]
          : Array.isArray(payload.aud)
            ? payload.aud
            : [];
      const scopes = new Set(
        [
          ...(typeof payload["scp"] === "string" ? payload["scp"].split(/\s+/u) : []),
          ...(typeof payload["scope"] === "string" ? payload["scope"].split(/\s+/u) : []),
        ].filter(Boolean),
      );
      if (
        payload.sub !== principal.subject ||
        payload.iss !== principal.issuer ||
        (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now())
      ) {
        return Effect.fail(new ProviderAuthenticationError({ provider, reason: "token_invalid" }));
      }
      if (!audiences.includes(authentication.audience)) {
        return Effect.fail(
          new ProviderAuthenticationError({ provider, reason: "audience_mismatch" }),
        );
      }
      if (!authentication.scopes.every((scope) => scopes.has(scope))) {
        return Effect.fail(new ProviderAuthenticationError({ provider, reason: "scope_mismatch" }));
      }
      return Effect.succeed(token);
    }),
  );

const withSubscriptionKey = (
  provider: ProviderConfig,
  context: ProviderAuthenticationContext,
  headers: Record<string, string>,
): Effect.Effect<Record<string, string>, ProviderAuthenticationError> => {
  const subscription = provider.subscription_key;
  if (subscription) {
    const header = subscription.header.trim();
    if (!header) {
      return Effect.succeed(headers);
    }
    const reference = subscription.secret_ref.trim();
    if (!reference) {
      return Effect.fail(
        new ProviderAuthenticationError({
          provider: provider.id,
          reason: "credential_unavailable",
        }),
      );
    }
    if (!context.secretStore) {
      return Effect.fail(
        new ProviderAuthenticationError({
          provider: provider.id,
          reason: "credential_unavailable",
        }),
      );
    }
    return context.secretStore.read(reference).pipe(
      Effect.mapError(
        () =>
          new ProviderAuthenticationError({
            provider: provider.id,
            reason: "credential_unavailable",
          }),
      ),
      Effect.flatMap((credential) =>
        credential
          ? Effect.succeed({ ...headers, [header]: credential })
          : Effect.fail(
              new ProviderAuthenticationError({
                provider: provider.id,
                reason: "credential_unavailable",
              }),
            ),
      ),
    );
  }
  if (context.directSubscriptionKey) {
    const header = context.directSubscriptionKey.header.trim();
    const value = context.directSubscriptionKey.value.trim();
    if (header && value) {
      return Effect.succeed({ ...headers, [header]: value });
    }
  }
  return Effect.succeed(headers);
};

export const resolveProviderHeaders = (
  provider: ProviderConfig,
  context: ProviderAuthenticationContext = {},
): Effect.Effect<Record<string, string>, ProviderAuthenticationError> => {
  const authentication = provider.authentication;
  if (authentication.type === "none") {
    return withSubscriptionKey(provider, context, {});
  }
  if (authentication.type === "api_key") {
    const direct = context.directApiKey?.trim();
    if (direct) {
      return withSubscriptionKey(provider, context, { Authorization: `Bearer ${direct}` });
    }
    const reference = authentication.secret_ref;
    if (!reference || !context.secretStore) {
      return Effect.fail(
        new ProviderAuthenticationError({
          provider: provider.id,
          reason: "credential_unavailable",
        }),
      );
    }
    const headers = context.secretStore.read(reference).pipe(
      Effect.mapError(
        () =>
          new ProviderAuthenticationError({
            provider: provider.id,
            reason: "credential_unavailable",
          }),
      ),
      Effect.flatMap((credential) =>
        credential
          ? Effect.succeed({ Authorization: `Bearer ${credential}` })
          : Effect.fail(
              new ProviderAuthenticationError({
                provider: provider.id,
                reason: "credential_unavailable",
              }),
            ),
      ),
    );
    return headers.pipe(Effect.flatMap((h) => withSubscriptionKey(provider, context, h)));
  }
  if (authentication.type === "managed_identity") {
    return acquireManagedIdentityToken(provider.id, authentication.resource, context.signal).pipe(
      Effect.map((token) => ({ Authorization: `Bearer ${token}` })),
      Effect.flatMap((h) => withSubscriptionKey(provider, context, h)),
    );
  }
  if (authentication.type === "apim_client") {
    const clientSecretReference = authentication.client_secret_ref;
    const directClientSecret = context.directClientSecret?.trim();
    if (!clientSecretReference && !directClientSecret) {
      return Effect.fail(
        new ProviderAuthenticationError({
          provider: provider.id,
          reason: "credential_unavailable",
        }),
      );
    }
    return Effect.gen(function* () {
      const clientSecret = directClientSecret
        ? directClientSecret
        : clientSecretReference && context.secretStore
          ? yield* context.secretStore.read(clientSecretReference).pipe(
              Effect.mapError(
                () =>
                  new ProviderAuthenticationError({
                    provider: provider.id,
                    reason: "credential_unavailable",
                  }),
              ),
            )
          : "";
      if (!clientSecret) {
        return yield* Effect.fail(
          new ProviderAuthenticationError({
            provider: provider.id,
            reason: "credential_unavailable",
          }),
        );
      }
      const token = yield* clientCredentialsToken(
        provider.id,
        authentication,
        clientSecret,
        context.signal,
      ).pipe(
        Effect.mapError((error) =>
          new ProviderAuthenticationError({
            provider: provider.id,
            reason:
              error.reason === "credential_unavailable"
                ? "credential_unavailable"
                : "token_unavailable",
          }),
        ),
      );
      const validated = yield* validateClientCredentialsToken(
        provider.id,
        authentication,
        token,
      );
      return validated;
    }).pipe(
      Effect.map((token) => ({ Authorization: `Bearer ${token}` })),
      Effect.flatMap((h) => withSubscriptionKey(provider, context, h)),
    );
  }
  if (!context.principal || context.principal.issuer_id !== authentication.issuer_id) {
    return Effect.fail(
      new ProviderAuthenticationError({
        provider: provider.id,
        reason: "identity_mismatch",
      }),
    );
  }
  if (!context.verifiedBearerToken) {
    return Effect.fail(
      new ProviderAuthenticationError({
        provider: provider.id,
        reason: "token_unavailable",
      }),
    );
  }
  return validatedDelegatedToken(
    provider.id,
    authentication,
    context.principal,
    context.verifiedBearerToken,
  ).pipe(
    Effect.flatMap((token) =>
      exchangeProviderToken(
        provider.id,
        authentication,
        context.principal!,
        token,
        context.secretStore,
        context.signal,
      ),
    ),
    Effect.mapError((error) =>
      error instanceof ProviderAuthenticationError
        ? error
        : new ProviderAuthenticationError({
            provider: provider.id,
            reason:
              error.reason === "credential_unavailable"
                ? "credential_unavailable"
                : "token_unavailable",
          }),
    ),
    Effect.map((token) => ({ Authorization: `Bearer ${token}` })),
    Effect.flatMap((h) => withSubscriptionKey(provider, context, h)),
  );
};
