import { createHash } from "node:crypto";
import type {
  NormalizedPrincipal,
  ProviderAuthentication,
} from "@local-studio/contracts/enterprise-auth";
import { Deferred, Effect, Schema } from "effect";
import type { ProviderSecretStore } from "./provider-secret-store";

type DelegatedAuthentication = Extract<
  ProviderAuthentication,
  { type: "oidc_user" | "apim_gateway" }
>;

const TokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  token_type: Schema.optional(Schema.String),
});

type TokenLease = { token: string; expiresAt: number };

export class ProviderTokenExchangeError extends Schema.TaggedErrorClass<ProviderTokenExchangeError>()(
  "ProviderTokenExchangeError",
  {
    provider: Schema.String,
    reason: Schema.Literals([
      "configuration_invalid",
      "credential_unavailable",
      "exchange_failed",
      "response_invalid",
    ]),
  },
) {}

const cache = new Map<string, TokenLease>();
const pending = new Map<string, Deferred.Deferred<TokenLease, ProviderTokenExchangeError>>();
const MAX_CACHE_ENTRIES = 1_024;

const failure = (
  provider: string,
  reason: ProviderTokenExchangeError["reason"],
): ProviderTokenExchangeError => new ProviderTokenExchangeError({ provider, reason });

const cacheLease = (key: string, lease: TokenLease): void => {
  const now = Date.now();
  for (const [entryKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(entryKey);
  }
  cache.set(key, lease);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
};

const exchangeKey = (
  provider: string,
  principal: NormalizedPrincipal,
  token: string,
  authentication: DelegatedAuthentication,
): string =>
  createHash("sha256")
    .update(
      [
        provider,
        principal.issuer,
        principal.tenant,
        principal.subject,
        authentication.audience,
        authentication.scopes.join(" "),
        authentication.token_exchange?.mode ?? "",
        authentication.token_exchange?.token_endpoint ?? "",
        authentication.token_exchange?.client_id ?? "",
        authentication.token_exchange?.client_secret_ref ?? "",
        token,
      ].join("\0"),
    )
    .digest("hex");

const endpoint = (
  provider: string,
  principal: NormalizedPrincipal,
  value: string,
): Effect.Effect<URL, ProviderTokenExchangeError> =>
  Effect.try({
    try: () => {
      const url = new URL(value);
      const issuer = new URL(principal.issuer);
      const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
      if ((!loopback && url.protocol !== "https:") || url.origin !== issuer.origin) {
        throw new Error("Token exchange endpoint is outside the validated issuer");
      }
      return url;
    },
    catch: () => failure(provider, "configuration_invalid"),
  });

const requestBody = (
  authentication: DelegatedAuthentication,
  subjectToken: string,
  clientSecret: string | undefined,
): URLSearchParams => {
  const exchange = authentication.token_exchange!;
  const body = new URLSearchParams({
    client_id: exchange.client_id,
    scope: authentication.scopes.join(" "),
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  if (exchange.mode === "entra_obo") {
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    body.set("assertion", subjectToken);
    body.set("requested_token_use", "on_behalf_of");
  } else {
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange");
    body.set("subject_token", subjectToken);
    body.set("subject_token_type", "urn:ietf:params:oauth:token-type:access_token");
    body.set("requested_token_type", "urn:ietf:params:oauth:token-type:access_token");
    body.set("audience", authentication.audience);
  }
  return body;
};

const waitForLease = (
  provider: string,
  deferred: Deferred.Deferred<TokenLease, ProviderTokenExchangeError>,
  signal: AbortSignal | undefined,
): Effect.Effect<TokenLease, ProviderTokenExchangeError> => {
  if (!signal) return Deferred.await(deferred);
  return Effect.raceFirst(
    Deferred.await(deferred),
    Effect.callback<TokenLease, ProviderTokenExchangeError>((resume) => {
      const abort = (): void => resume(Effect.fail(failure(provider, "exchange_failed")));
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      return Effect.sync(() => signal.removeEventListener("abort", abort));
    }),
  );
};

export const exchangeProviderToken = (
  provider: string,
  authentication: DelegatedAuthentication,
  principal: NormalizedPrincipal,
  subjectToken: string,
  secretStore: ProviderSecretStore | undefined,
  signal?: AbortSignal,
): Effect.Effect<string, ProviderTokenExchangeError> =>
  Effect.gen(function* () {
    const exchange = authentication.token_exchange;
    if (!exchange) return subjectToken;
    const key = exchangeKey(provider, principal, subjectToken, authentication);
    const cached = cache.get(key);
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
    let deferred = pending.get(key);
    if (!deferred) {
      deferred = Deferred.makeUnsafe<TokenLease, ProviderTokenExchangeError>();
      pending.set(key, deferred);
      const active = deferred;
      yield* Effect.gen(function* () {
        const url = yield* endpoint(provider, principal, exchange.token_endpoint);
        const clientSecret = exchange.client_secret_ref
          ? yield* secretStore
              ? secretStore
                  .read(exchange.client_secret_ref)
                  .pipe(Effect.mapError(() => failure(provider, "credential_unavailable")))
              : Effect.fail(failure(provider, "credential_unavailable"))
          : undefined;
        if (exchange.client_secret_ref && !clientSecret) {
          return yield* Effect.fail(failure(provider, "credential_unavailable"));
        }
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: requestBody(authentication, subjectToken, clientSecret),
              signal: AbortSignal.timeout(10_000),
              redirect: "error",
            }),
          catch: () => failure(provider, "exchange_failed"),
        });
        if (!response.ok) return yield* Effect.fail(failure(provider, "exchange_failed"));
        const declaredLength = Number(response.headers.get("content-length") ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > 65_536) {
          return yield* Effect.fail(failure(provider, "response_invalid"));
        }
        const responseText = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => failure(provider, "response_invalid"),
        });
        if (responseText.length > 65_536) {
          return yield* Effect.fail(failure(provider, "response_invalid"));
        }
        const payload = yield* Effect.try({
          try: () => JSON.parse(responseText),
          catch: () => failure(provider, "response_invalid"),
        });
        const decoded = yield* Schema.decodeUnknownEffect(TokenResponseSchema)(payload).pipe(
          Effect.mapError(() => failure(provider, "response_invalid")),
        );
        if (decoded.token_type && decoded.token_type.toLowerCase() !== "bearer") {
          return yield* Effect.fail(failure(provider, "response_invalid"));
        }
        if (!decoded.access_token || decoded.access_token.length > 65_536) {
          return yield* Effect.fail(failure(provider, "response_invalid"));
        }
        const expiresIn = Number(decoded.expires_in);
        const leaseSeconds =
          Number.isFinite(expiresIn) && expiresIn > 0
            ? Math.min(Math.floor(expiresIn), 86_400)
            : 300;
        const lease = {
          token: decoded.access_token,
          expiresAt: Date.now() + leaseSeconds * 1000,
        };
        cacheLease(key, lease);
        return lease;
      }).pipe(
        Effect.tap((lease) => Deferred.succeed(active, lease)),
        Effect.tapError((error) => Deferred.fail(active, error)),
        Effect.ensuring(
          Effect.sync(() => {
            pending.delete(key);
          }),
        ),
        Effect.forkDetach({ startImmediately: true }),
      );
    }
    return (yield* waitForLease(provider, deferred, signal)).token;
  });

const clientCredentialsKey = (
  provider: string,
  tokenEndpoint: string,
  clientId: string,
  scope: string,
  audience: string,
): string =>
  createHash("sha256")
    .update(["client_credentials", provider, tokenEndpoint, clientId, scope, audience].join("\0"))
    .digest("hex");

const clientCredentialsRequestBody = (
  clientId: string,
  clientSecret: string,
  scope: string,
): URLSearchParams =>
  new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

export const clientCredentialsToken = (
  provider: string,
  authentication: Extract<ProviderAuthentication, { type: "apim_client" }>,
  clientSecret: string,
  signal?: AbortSignal,
): Effect.Effect<string, ProviderTokenExchangeError> =>
  Effect.gen(function* () {
    const scope = authentication.scopes.join(" ");
    const key = clientCredentialsKey(
      provider,
      authentication.token_endpoint,
      authentication.client_id,
      scope,
      authentication.audience,
    );
    const cached = cache.get(key);
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
    let deferred = pending.get(key);
    if (!deferred) {
      deferred = Deferred.makeUnsafe<TokenLease, ProviderTokenExchangeError>();
      pending.set(key, deferred);
      const active = deferred;
      yield* Effect.gen(function* () {
        const url = new URL(authentication.token_endpoint);
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: clientCredentialsRequestBody(
                authentication.client_id,
                clientSecret,
                scope,
              ),
              signal: AbortSignal.timeout(10_000),
              redirect: "error",
            }),
          catch: () => failure(provider, "exchange_failed"),
        });
        if (!response.ok) return yield* Effect.fail(failure(provider, "exchange_failed"));
        const declaredLength = Number(response.headers.get("content-length") ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > 65_536) {
          return yield* Effect.fail(failure(provider, "response_invalid"));
        }
        const responseText = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => failure(provider, "response_invalid"),
        });
        if (responseText.length > 65_536) {
          return yield* Effect.fail(failure(provider, "response_invalid"));
        }
        const payload = yield* Effect.try({
          try: () => JSON.parse(responseText),
          catch: () => failure(provider, "response_invalid"),
        });
        const decoded = yield* Schema.decodeUnknownEffect(TokenResponseSchema)(payload).pipe(
          Effect.mapError(() => failure(provider, "response_invalid")),
        );
        if (decoded.token_type && decoded.token_type.toLowerCase() !== "bearer") {
          return yield* Effect.fail(failure(provider, "response_invalid"));
        }
        if (!decoded.access_token || decoded.access_token.length > 65_536) {
          return yield* Effect.fail(failure(provider, "response_invalid"));
        }
        const expiresIn = Number(decoded.expires_in);
        const leaseSeconds =
          Number.isFinite(expiresIn) && expiresIn > 0
            ? Math.min(Math.floor(expiresIn), 86_400)
            : 300;
        const lease = { token: decoded.access_token, expiresAt: Date.now() + leaseSeconds * 1000 };
        cacheLease(key, lease);
        return lease;
      }).pipe(
        Effect.tap((lease) => Deferred.succeed(active, lease)),
        Effect.tapError((error) => Deferred.fail(active, error)),
        Effect.ensuring(
          Effect.sync(() => {
            pending.delete(key);
          }),
        ),
        Effect.forkDetach({ startImmediately: true }),
      );
    }
    return (yield* waitForLease(provider, deferred, signal)).token;
  });
