import { Effect, Schema } from "effect";
import { badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { savePersistedConfig, type ProviderConfig } from "../../config/persisted-config";
import {
  FoundryProjectConnectionSchema,
  ProviderAuthenticationSchema,
} from "@local-studio/contracts/enterprise-auth";
import {
  discoverProviderModels,
  isReservedProviderId,
  providerIsDiscoverable,
} from "../../services/provider-routing";
import { normalizeProviderAuthentication } from "../../services/provider-authentication";
import { normalizeAdmittedProviderBaseUrl } from "../../services/provider-boundary";
import {
  newProviderApiKeyReference,
  newProviderClientSecretReference,
  newProviderSubscriptionKeyReference,
  type ProviderSecretMutation,
  type ProviderSecretStore,
} from "../../services/provider-secret-store";

type ProviderView = {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  has_api_key: boolean;
  authentication: ProviderConfig["authentication"];
  subscription_key: ProviderConfig["subscription_key"];
  foundry: ProviderConfig["foundry"];
  path_style: ProviderConfig["path_style"];
  api_version: ProviderConfig["api_version"];
};

const ProviderSubscriptionKeyPayloadSchema = Schema.Struct({
  header: Schema.String,
  value: Schema.String,
});

const ProviderCreateSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  base_url: Schema.String,
  api_key: Schema.optional(Schema.String),
  client_secret: Schema.optional(Schema.String),
  foundry_client_secret: Schema.optional(Schema.String),
  subscription_key: Schema.optional(ProviderSubscriptionKeyPayloadSchema),
  enabled: Schema.optional(Schema.Boolean),
  authentication: Schema.optional(ProviderAuthenticationSchema),
  foundry: Schema.optional(FoundryProjectConnectionSchema),
  path_style: Schema.optional(Schema.Literals(["openai", "azure"])),
  api_version: Schema.optional(Schema.String),
});

const ProviderUpdateSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  base_url: Schema.optional(Schema.String),
  api_key: Schema.optional(Schema.String),
  client_secret: Schema.optional(Schema.String),
  foundry_client_secret: Schema.optional(Schema.String),
  subscription_key: Schema.optional(ProviderSubscriptionKeyPayloadSchema),
  enabled: Schema.optional(Schema.Boolean),
  authentication: Schema.optional(ProviderAuthenticationSchema),
  foundry: Schema.optional(FoundryProjectConnectionSchema),
  path_style: Schema.optional(Schema.Literals(["openai", "azure"])),
  api_version: Schema.optional(Schema.String),
});

const ProviderProbeSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  base_url: Schema.String,
  api_key: Schema.optional(Schema.String),
  client_secret: Schema.optional(Schema.String),
  subscription_key: Schema.optional(ProviderSubscriptionKeyPayloadSchema),
  authentication: Schema.optional(ProviderAuthenticationSchema),
  path_style: Schema.optional(Schema.Literals(["openai", "azure"])),
  api_version: Schema.optional(Schema.String),
});

class ProviderPersistenceError extends Schema.TaggedErrorClass<ProviderPersistenceError>()(
  "ProviderPersistenceError",
  { message: Schema.String, source: Schema.optional(Schema.Unknown) },
) {}

const serializeProvider = (provider: ProviderConfig, hasApiKey: boolean): ProviderView => ({
  id: provider.id,
  name: provider.name,
  base_url: provider.base_url,
  enabled: provider.enabled,
  has_api_key: hasApiKey,
  authentication: provider.authentication,
  subscription_key: provider.subscription_key,
  foundry: provider.foundry,
  path_style: provider.path_style,
  api_version: provider.api_version,
});

const saveProviders = (
  context: {
    config: { data_dir: string; providers: ProviderConfig[] };
    providerSecretStore: ProviderSecretStore;
  },
  providers: ProviderConfig[],
  secretMutations: readonly ProviderSecretMutation[] = [],
): Effect.Effect<void, ProviderPersistenceError> =>
  Effect.try({
    try: () => {
      context.providerSecretStore.mutateSync(secretMutations, () => {
        savePersistedConfig(context.config.data_dir, { providers }, context.providerSecretStore);
        context.config.providers = providers;
      });
    },
    catch: (source) =>
      new ProviderPersistenceError({ message: "Could not save providers", source }),
  });

const required = (
  value: string,
  label: string,
): Effect.Effect<string, ReturnType<typeof badRequest>> => {
  const trimmed = value.trim();
  return trimmed ? Effect.succeed(trimmed) : Effect.fail(badRequest(`${label} is required`));
};

const normalizedBaseUrl = (value: string): Effect.Effect<string, ReturnType<typeof badRequest>> =>
  Effect.try({
    try: () => normalizeAdmittedProviderBaseUrl(value),
    catch: () => badRequest("base_url host must be listed in LOCAL_STUDIO_PROVIDER_HOST_ALLOWLIST"),
  });

const normalizedProviderId = (
  value: string,
): Effect.Effect<string, ReturnType<typeof badRequest>> =>
  required(value, "id").pipe(
    Effect.map((id) => id.toLowerCase()),
    Effect.filterOrFail(
      (id) => /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id),
      () => badRequest("id must use 1-64 lowercase letters, numbers, underscores, or hyphens"),
    ),
    Effect.filterOrFail(
      (id) => !isReservedProviderId(id),
      () => badRequest('Provider id "openai" is reserved for local inference'),
    ),
  );

const normalizedCredentials = (
  providerId: string,
  apiKey: string,
  authentication: ProviderConfig["authentication"],
  hasStoredApiKey: boolean,
): Effect.Effect<ProviderConfig["authentication"], ReturnType<typeof badRequest>> => {
  let normalized: ProviderConfig["authentication"];
  try {
    normalized = normalizeProviderAuthentication(providerId, authentication);
  } catch {
    return Effect.fail(badRequest("Provider authentication configuration is invalid"));
  }
  if (normalized.type === "none") {
    return apiKey
      ? Effect.fail(badRequest("api_key is not accepted for keyless authentication"))
      : Effect.succeed(normalized);
  }
  if (normalized.type === "api_key") {
    return apiKey || hasStoredApiKey
      ? Effect.succeed(normalized)
      : Effect.fail(badRequest("api_key is required when authentication.type is api_key"));
  }
  return apiKey
    ? Effect.fail(badRequest("api_key is not accepted for this authentication type"))
    : Effect.succeed(normalized);
};

const subscriptionKeyCredentialSet = (
  providerId: string,
  current: ProviderConfig["subscription_key"],
  update: { header: string; value: string } | undefined,
): {
  subscription_key: ProviderConfig["subscription_key"];
  mutations: ProviderSecretMutation[];
} => {
  if (!update) return { subscription_key: current, mutations: [] };
  const header = update.header.trim();
  const value = update.value.trim();
  if (!header) {
    if (current) return { subscription_key: current, mutations: [] };
    return { subscription_key: undefined, mutations: [] };
  }
  if (!value) {
    return { subscription_key: undefined, mutations: [] };
  }
  const reference = newProviderSubscriptionKeyReference(providerId);
  return {
    subscription_key: { header, secret_ref: reference },
    mutations: [{ ref: reference, value }],
  };
};

const withVersionedCredentialReferences = (
  providerId: string,
  authentication: ProviderConfig["authentication"],
  apiKey: string,
  clientSecret: string,
): {
  authentication: ProviderConfig["authentication"];
  mutations: ProviderSecretMutation[];
} => {
  let next = authentication;
  const mutations: ProviderSecretMutation[] = [];
  if (next.type === "api_key" && apiKey) {
    const reference = newProviderApiKeyReference(providerId);
    next = { type: "api_key", secret_ref: reference };
    mutations.push({ ref: reference, value: apiKey });
  }
  if (
    (next.type === "oidc_user" || next.type === "apim_gateway") &&
    next.token_exchange &&
    clientSecret
  ) {
    const reference = newProviderClientSecretReference(providerId);
    next = {
      ...next,
      token_exchange: { ...next.token_exchange, client_secret_ref: reference },
    };
    mutations.push({ ref: reference, value: clientSecret });
  }
  if (next.type === "apim_client" && clientSecret) {
    const reference = newProviderClientSecretReference(providerId);
    next = { ...next, client_secret_ref: reference };
    mutations.push({ ref: reference, value: clientSecret });
  }
  return { authentication: next, mutations };
};

const withFoundryClientSecretReference = (
  providerId: string,
  foundry: ProviderConfig["foundry"],
  clientSecret: string,
): {
  foundry: ProviderConfig["foundry"];
  mutations: ProviderSecretMutation[];
} => {
  if (!foundry || !clientSecret) return { foundry, mutations: [] };
  const authentication = foundry.authentication;
  if (
    (authentication.type !== "oidc_user" && authentication.type !== "apim_gateway") ||
    !authentication.token_exchange
  ) {
    throw new TypeError("Foundry client secret requires delegated token exchange");
  }
  const reference = newProviderClientSecretReference(providerId);
  return {
    foundry: {
      ...foundry,
      authentication: {
        ...authentication,
        token_exchange: {
          ...authentication.token_exchange,
          client_secret_ref: reference,
        },
      },
    },
    mutations: [{ ref: reference, value: clientSecret }],
  };
};

export const registerStudioProviderRoutes = defineRoutes((app, context) => {
  return mergeRoutes(
    app.get(
      "/studio/providers",
      documentRoute,
      effectHandler((ctx) =>
        Effect.sync(() =>
          ctx.json({
            providers: context.config.providers.map((provider) =>
              serializeProvider(
                provider,
                provider.authentication.type === "api_key" &&
                  Boolean(
                    provider.authentication.secret_ref &&
                    context.providerSecretStore.readSync(provider.authentication.secret_ref),
                  ),
              ),
            ),
          }),
        ),
      ),
    ),

    app.post(
      "/studio/providers/probe",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, ProviderProbeSchema);
          const id = yield* normalizedProviderId(body.id);
          const name = yield* required(body.name, "name");
          const baseUrl = yield* normalizedBaseUrl(yield* required(body.base_url, "base_url"));
          const apiKey = body.api_key?.trim() ?? "";
          const authentication = yield* normalizedCredentials(
            id,
            apiKey,
            body.authentication ?? (apiKey ? { type: "api_key" } : { type: "none" }),
            false,
          );
          const catalog = yield* discoverProviderModels(
            {
              id,
              name,
              base_url: baseUrl,
              enabled: true,
              authentication,
              ...(body.path_style ? { path_style: body.path_style } : {}),
              ...(body.api_version ? { api_version: body.api_version } : {}),
            },
            fetch,
            {
              directApiKey: apiKey,
              directClientSecret: body.client_secret,
              directSubscriptionKey: body.subscription_key,
              principal: ctx.get("enterprisePrincipal"),
              verifiedBearerToken: ctx.get("enterpriseBearerToken"),
              signal: ctx.req.raw.signal,
            },
          ).pipe(
            Effect.mapError(() => serviceUnavailable(`Provider "${id}" model discovery failed`)),
          );
          return ctx.json(catalog);
        }),
      ),
    ),

    app.post(
      "/studio/providers",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, ProviderCreateSchema);
          const id = yield* normalizedProviderId(body.id);
          const name = yield* required(body.name, "name");
          const baseUrl = yield* normalizedBaseUrl(yield* required(body.base_url, "base_url"));
          if (context.config.providers.some((provider) => provider.id.toLowerCase() === id)) {
            return yield* Effect.fail(badRequest(`Provider "${id}" already exists`));
          }
          const apiKey = body.api_key?.trim() ?? "";
          const clientSecret = body.client_secret?.trim() ?? "";
          const foundryClientSecret = body.foundry_client_secret?.trim() ?? "";
          const authentication = yield* normalizedCredentials(
            id,
            apiKey,
            body.authentication ?? (apiKey ? { type: "api_key" } : { type: "none" }),
            false,
          );
          if (
            clientSecret &&
            !(
              ((authentication.type === "oidc_user" || authentication.type === "apim_gateway") &&
                authentication.token_exchange) ||
              authentication.type === "apim_client"
            )
          ) {
            return yield* Effect.fail(
              badRequest("client_secret requires delegated token exchange or apim_client"),
            );
          }
          const credentialSet = withVersionedCredentialReferences(
            id,
            authentication,
            apiKey,
            clientSecret,
          );
          const subscriptionKeySet = subscriptionKeyCredentialSet(
            id,
            undefined,
            body.subscription_key,
          );
          const foundryCredentialSet = yield* Effect.try({
            try: () => withFoundryClientSecretReference(id, body.foundry, foundryClientSecret),
            catch: () => badRequest("foundry_client_secret requires delegated token exchange"),
          });
          const provider: ProviderConfig = {
            id,
            name,
            base_url: baseUrl,
            enabled: body.enabled ?? true,
            authentication: credentialSet.authentication,
            ...(subscriptionKeySet.subscription_key
              ? { subscription_key: subscriptionKeySet.subscription_key }
              : {}),
            ...(foundryCredentialSet.foundry ? { foundry: foundryCredentialSet.foundry } : {}),
            ...(body.path_style ? { path_style: body.path_style } : {}),
            ...(body.api_version ? { api_version: body.api_version } : {}),
          };
          yield* saveProviders(
            context,
            [...context.config.providers, provider],
            [
              ...credentialSet.mutations,
              ...subscriptionKeySet.mutations,
              ...foundryCredentialSet.mutations,
            ],
          );
          return ctx.json({
            success: true,
            provider: serializeProvider(provider, credentialSet.authentication.type === "api_key"),
          });
        }),
      ),
    ),

    app.put(
      "/studio/providers/:id",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const providerId = ctx.req.param("id") ?? "";
          if (isReservedProviderId(providerId)) {
            return yield* Effect.fail(
              badRequest('Provider id "openai" is reserved for local inference'),
            );
          }
          const body = yield* decodeJsonBody(ctx, ProviderUpdateSchema);
          const index = context.config.providers.findIndex(
            (provider) => provider.id === providerId,
          );
          const current = index >= 0 ? context.config.providers[index] : undefined;
          if (!current) return yield* Effect.fail(notFound(`Provider "${providerId}" not found`));
          const name = body.name === undefined ? current.name : yield* required(body.name, "name");
          const baseUrl =
            body.base_url === undefined
              ? current.base_url
              : yield* normalizedBaseUrl(yield* required(body.base_url, "base_url"));
          const apiKey = body.api_key?.trim() ?? "";
          const clientSecret = body.client_secret?.trim() ?? "";
          const foundryClientSecret = body.foundry_client_secret?.trim() ?? "";
          const requestedAuthentication =
            body.authentication ??
            (body.api_key === undefined
              ? current.authentication
              : apiKey
                ? { type: "api_key" }
                : { type: "none" });
          const authentication =
            requestedAuthentication.type === "api_key" &&
            !requestedAuthentication.secret_ref &&
            current.authentication.type === "api_key" &&
            current.authentication.secret_ref
              ? {
                  ...requestedAuthentication,
                  secret_ref: current.authentication.secret_ref,
                }
              : requestedAuthentication;
          const hasStoredApiKey =
            current.authentication.type === "api_key" &&
            Boolean(
              current.authentication.secret_ref &&
              context.providerSecretStore.readSync(current.authentication.secret_ref),
            );
          const normalizedAuthentication = yield* normalizedCredentials(
            providerId,
            apiKey,
            authentication,
            hasStoredApiKey,
          );
          if (
            clientSecret &&
            !(
              ((normalizedAuthentication.type === "oidc_user" ||
                normalizedAuthentication.type === "apim_gateway") &&
                normalizedAuthentication.token_exchange) ||
              normalizedAuthentication.type === "apim_client"
            )
          ) {
            return yield* Effect.fail(
              badRequest("client_secret requires delegated token exchange or apim_client"),
            );
          }
          const credentialSet = withVersionedCredentialReferences(
            providerId,
            normalizedAuthentication,
            apiKey,
            clientSecret,
          );
          const subscriptionKeySet = subscriptionKeyCredentialSet(
            providerId,
            current.subscription_key,
            body.subscription_key,
          );
          const foundryCredentialSet = yield* Effect.try({
            try: () =>
              withFoundryClientSecretReference(
                providerId,
                body.foundry ?? current.foundry,
                foundryClientSecret,
              ),
            catch: () => badRequest("foundry_client_secret requires delegated token exchange"),
          });
          const updated: ProviderConfig = {
            id: providerId,
            name,
            base_url: baseUrl,
            enabled: body.enabled ?? current.enabled,
            authentication: credentialSet.authentication,
            ...(subscriptionKeySet.subscription_key
              ? { subscription_key: subscriptionKeySet.subscription_key }
              : {}),
            ...(foundryCredentialSet.foundry ? { foundry: foundryCredentialSet.foundry } : {}),
            ...(body.path_style ? { path_style: body.path_style } : {}),
            ...(body.api_version ? { api_version: body.api_version } : {}),
          };
          const providers = [...context.config.providers];
          providers[index] = updated;
          const secretMutations: ProviderSecretMutation[] = [
            ...credentialSet.mutations,
            ...subscriptionKeySet.mutations,
            ...foundryCredentialSet.mutations,
          ];
          yield* saveProviders(context, providers, secretMutations);
          return ctx.json({
            success: true,
            provider: serializeProvider(updated, credentialSet.authentication.type === "api_key"),
          });
        }),
      ),
    ),

    app.delete(
      "/studio/providers/:id",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const providerId = ctx.req.param("id") ?? "";
          if (!context.config.providers.some((provider) => provider.id === providerId)) {
            return yield* Effect.fail(notFound(`Provider "${providerId}" not found`));
          }
          yield* saveProviders(
            context,
            context.config.providers.filter((provider) => provider.id !== providerId),
          );
          return ctx.json({ success: true });
        }),
      ),
    ),

    app.get(
      "/studio/provider-models",
      documentRoute,
      effectHandler((ctx) =>
        Effect.forEach(
          context.config.providers.filter(providerIsDiscoverable),
          (provider) =>
            discoverProviderModels(provider, fetch, {
              secretStore: context.providerSecretStore,
              principal: ctx.get("enterprisePrincipal"),
              verifiedBearerToken: ctx.get("enterpriseBearerToken"),
              signal: ctx.req.raw.signal,
            }).pipe(Effect.option),
          { concurrency: "unbounded" },
        ).pipe(
          Effect.map((results) =>
            ctx.json({
              providers: results.flatMap((result) =>
                result._tag === "Some" ? [result.value] : [],
              ),
            }),
          ),
        ),
      ),
    ),
  );
});
