import type { RequestOptions } from "./core";

/** Registry records as consumed from the published local-ai-registry. */
export interface RegistryIndexRow {
  id: string;
  recipe_source: string;
  status: "candidate" | "validated";
  model_instance_id: string;
  hardware_id: string;
  hardware_count: number;
  engine: string;
  launch_kind: string;
  has_evidence: boolean;
  capabilities: {
    chat: boolean | null;
    reasoning: boolean | null;
    tools: boolean | null;
    vision: boolean | null;
  };
}

export interface RegistryHardwareMatch {
  hardware_id: string;
  registry_name: string;
  detected_name: string;
  vendor: string;
  memory_gb: number | null;
  registry_memory_gb: number | null;
  detected_count: number;
  matched: boolean;
  reason: string;
}

export interface RegistryRecommendations {
  base_url: string;
  fetched_at: string;
  counts: { total: number; matched: number };
  matches: RegistryHardwareMatch[];
  rows: Array<{ row: RegistryIndexRow; fit: { state: "match" | "other"; hardware_match: RegistryHardwareMatch | null } }>;
  hardware_records: Record<string, unknown>;
}

export type RegistryRecord = Record<string, unknown>;

export interface SharePreviewPayload {
  recipe_id: string;
  recipe_name: string;
  shareable: boolean;
  reason: string | null;
  records: { model?: unknown; model_instance: unknown; recipe: unknown };
  file_paths: string[];
  model_exists_in_registry: boolean | null;
  validation: { ok: boolean; issues: Array<{ path: string; message: string }> };
  redactions: string[];
  hardware: { id: string; name: string; count: number } | null;
  pr: {
    base_repo: string;
    base_branch: string;
    head_branch: string;
    title: string;
    body: string;
  };
}

export interface SharePullRequestResult {
  pull_request_url: string;
  number: number;
  head_branch: string;
  files: string[];
}

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
