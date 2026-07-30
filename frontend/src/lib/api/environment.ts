import type {
  KubernetesConnectionConfig,
  KubernetesConnectionState,
} from "@local-studio/contracts/environment-commissioning";
import type { ApiCore } from "./core";

export const createEnvironmentApi = (core: ApiCore) => ({
  getKubernetesConnection: (): Promise<KubernetesConnectionState> =>
    core.request("/environment/kubernetes", { retries: 0 }),
  saveKubernetesConnection: (
    configuration: KubernetesConnectionConfig,
  ): Promise<KubernetesConnectionState> =>
    core.request("/environment/kubernetes", {
      method: "PUT",
      body: JSON.stringify(configuration),
      retries: 0,
    }),
  probeKubernetesConnection: (): Promise<KubernetesConnectionState> =>
    core.request("/environment/kubernetes/probe", { method: "POST", retries: 0 }),
});
