import {
  KubernetesConnectionConfigSchema,
  type KubernetesConnectionConfig,
  type KubernetesConnectionProbe,
  type KubernetesConnectionState,
} from "@local-studio/contracts/environment-commissioning";
import { Effect } from "effect";
import { badRequest, serviceUnavailable } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { savePersistedConfig } from "../../config/persisted-config";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { KubeRayGateway } from "../workbench/kuberay-gateway";
import {
  prepareKubernetesConnection,
  responseKubernetesConnection,
} from "./configuration";

const unconfiguredProbe = (): KubernetesConnectionProbe => ({
  state: "unconfigured",
  checked_at: null,
  kubernetes_version: null,
  ray_api_version: null,
  detail: "No Kubernetes connection is enabled.",
});

const configuredProbe = (): KubernetesConnectionProbe => ({
  state: "claimed",
  checked_at: null,
  kubernetes_version: null,
  ray_api_version: null,
  detail: "Connection metadata is saved. Run the probe to establish live evidence.",
});

const configurationFromContext = (context: {
  config: {
    data_dir: string;
    kuberay_api_url?: string;
    kuberay_token_file?: string;
    kuberay_ca_file?: string;
  };
}): KubernetesConnectionConfig =>
  responseKubernetesConnection(
    {
      enabled: Boolean(context.config.kuberay_api_url && context.config.kuberay_token_file),
      api_url: context.config.kuberay_api_url ?? "",
      token_file: context.config.kuberay_token_file ?? "",
      ca_file: context.config.kuberay_ca_file ?? null,
    },
    context.config.data_dir,
  );

const gatewayFor = (configuration: KubernetesConnectionConfig): KubeRayGateway | null =>
  configuration.enabled
    ? new KubeRayGateway({
        apiUrl: configuration.api_url.replace(/\/+$/u, ""),
        tokenFile: configuration.token_file,
        ...(configuration.ca_file ? { caFile: configuration.ca_file } : {}),
      })
    : null;

const observedState = (
  configuration: KubernetesConnectionConfig,
  result: { kubernetesVersion: string; rayApiVersion: string },
): KubernetesConnectionState => ({
  configuration,
  probe: {
    state: "observed",
    checked_at: new Date().toISOString(),
    kubernetes_version: result.kubernetesVersion,
    ray_api_version: result.rayApiVersion,
    detail: "Kubernetes and the RayJob API responded with validated documents.",
  },
});

const contradictedState = (
  configuration: KubernetesConnectionConfig,
): KubernetesConnectionState => ({
  configuration,
  probe: {
    state: "contradicted",
    checked_at: new Date().toISOString(),
    kubernetes_version: null,
    ray_api_version: null,
    detail: "Cluster probe failed. Verify endpoint reachability and controller credential references.",
  },
});

export const registerEnvironmentRoutes = defineRoutes((app, context) =>
  mergeRoutes(
    app.get(
      "/environment/kubernetes",
      documentRoute,
      effectHandler((ctx) =>
        Effect.succeed(
          ctx.json({
            configuration: configurationFromContext(context),
            probe: context.kubeRayGateway ? configuredProbe() : unconfiguredProbe(),
          } satisfies KubernetesConnectionState),
        ),
      ),
    ),
    app.put(
      "/environment/kubernetes",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const configuration = yield* decodeJsonBody(ctx, KubernetesConnectionConfigSchema);
          const prepared = yield* Effect.try({
            try: () =>
              prepareKubernetesConnection(configuration, context.config.data_dir, {
                ...(context.config.kuberay_api_url
                  ? { apiUrl: context.config.kuberay_api_url }
                  : {}),
                ...(context.config.kuberay_token_file
                  ? { tokenFile: context.config.kuberay_token_file }
                  : {}),
                ...(context.config.kuberay_ca_file
                  ? { caFile: context.config.kuberay_ca_file }
                  : {}),
              }),
            catch: (error) =>
              badRequest(error instanceof Error ? error.message : "Invalid Kubernetes connection"),
          });
          yield* Effect.try({
            try: () =>
              savePersistedConfig(context.config.data_dir, {
                kubernetes_connection: prepared.persisted,
              }),
            catch: () => serviceUnavailable("Kubernetes configuration could not be saved"),
          });
          context.kubeRayGateway = gatewayFor(prepared.runtime);
          if (prepared.runtime.enabled) {
            context.config.kuberay_api_url = prepared.runtime.api_url;
            context.config.kuberay_token_file = prepared.runtime.token_file;
            if (prepared.runtime.ca_file) {
              context.config.kuberay_ca_file = prepared.runtime.ca_file;
            } else {
              delete context.config.kuberay_ca_file;
            }
          } else {
            delete context.config.kuberay_api_url;
            delete context.config.kuberay_token_file;
            delete context.config.kuberay_ca_file;
          }
          return ctx.json({
            configuration: prepared.response,
            probe: prepared.runtime.enabled ? configuredProbe() : unconfiguredProbe(),
          } satisfies KubernetesConnectionState);
        }),
      ),
    ),
    app.post(
      "/environment/kubernetes/probe",
      documentRoute,
      effectHandler((ctx) => {
        const configuration = configurationFromContext(context);
        if (!context.kubeRayGateway) {
          return Effect.succeed(
            ctx.json({
              configuration,
              probe: unconfiguredProbe(),
            } satisfies KubernetesConnectionState),
          );
        }
        return context.kubeRayGateway.probe().pipe(
          Effect.map((result) => ctx.json(observedState(configuration, result))),
          Effect.catch(() => Effect.succeed(ctx.json(contradictedState(configuration)))),
        );
      }),
    ),
  ),
);
