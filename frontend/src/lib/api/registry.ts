import type { RequestOptions } from "./core";
import type {
  RegistryHardware,
  RegistryRecord,
  RegistryRecommendationsPayload,
  SharePreviewPayload,
  SharePullRequestResult,
} from "@local-studio/contracts/registry";

export type {
  RegistryIndexRow,
  RegistryHardwareMatch,
  RegistryRecord,
  RegistryRecommendationsPayload,
  SharePreviewPayload,
  SharePullRequestResult,
} from "@local-studio/contracts/registry";

/** The recommendations payload as delivered over the controller API. */
export type RegistryRecommendations = RegistryRecommendationsPayload & {
  hardware_records: Record<string, RegistryHardware>;
};

export function createRegistryApi(core: import("./core").ApiCore) {
  return {
    getRegistryRecommendations: (options?: { all?: boolean } & RequestOptions): Promise<RegistryRecommendations> =>
      core.request(`/registry/recommendations${options?.all ? "?all=1" : ""}`, options),

    getRegistryRecord: (
      collection: string,
      id: string,
      options?: RequestOptions,
    ): Promise<{ data: RegistryRecord; meta: { collection: string; id: string } }> =>
      core.request(`/registry/records/${collection}/${encodeURIComponent(id)}`, options),

    getShareNotice: (options?: RequestOptions): Promise<{ notice: string }> =>
      core.request("/registry/share/notice", options),

    getSharePreview: (recipeId: string, options?: RequestOptions): Promise<SharePreviewPayload> =>
      core.request(
        `/registry/share/preview?recipe_id=${encodeURIComponent(recipeId)}`,
        options,
      ),

    createSharePullRequest: (
      recipeId: string,
      confirm: boolean,
      options?: RequestOptions,
    ): Promise<SharePullRequestResult> =>
      core.request("/registry/share/pr", {
        ...options,
        method: "POST",
        body: JSON.stringify({ recipe_id: recipeId, confirm }),
      }),
  };
}
