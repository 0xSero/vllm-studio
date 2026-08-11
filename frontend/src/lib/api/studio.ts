import { Schema } from "effect";
import {
  ModelIndexSchema,
  bundledModelIndexSource,
  type ModelIndexResponse,
} from "@local-studio/contracts/model-index";
import type {
  ModelDownload,
  EngineJob,
  ModelInfo,
  StarterPreset,
  StorageInfo,
  StudioDiagnostics,
  StudioSettings,
  RuntimeBackendInfo,
  RuntimeCudaInfo,
  RuntimeRocmInfo,
  RuntimeTarget,
} from "../types";
import { encodePathSegments, type ApiCore, type RequestOptions } from "./core";

export type {
  ModelIndexModel,
  ModelIndexResponse,
  ModelIndexTier,
  ModelIndexVariant,
  ModelIndexVariantFormat,
} from "@local-studio/contracts/model-index";

export interface StudioModelsRoot {
  path: string;
  exists: boolean;
  sources?: string[];
  recipe_ids?: string[];
}

export interface VllmRuntimeInfo {
  installed: boolean;
  version: string | null;
  python_path: string | null;
  vllm_bin: string | null;
  upgrade_command_available?: boolean;
  bundled_wheel: {
    path: string;
    version: string | null;
  } | null;
}

export interface VllmRuntimeConfig {
  config: string | null;
  error?: string | null;
}

export interface RuntimeJobResponse {
  job_id: string;
  job: EngineJob;
}

const bundledModelIndex = Schema.decodeUnknownSync(ModelIndexSchema)(bundledModelIndexSource);

const hasStatus = (error: unknown, status: number): boolean =>
  error instanceof Error && (error as Error & { status?: number }).status === status;

export function createStudioApi(core: ApiCore) {
  return {
    getModels: (): Promise<{
      models: ModelInfo[];
      roots?: StudioModelsRoot[];
      configured_models_dir?: string;
    }> => core.get("/v1/studio/models"),

    getStudioSettings: (options?: RequestOptions): Promise<StudioSettings> =>
      core.get("/studio/settings", options),

    updateStudioSettings: (payload: {
      models_dir?: string | null;
      ui_preferences?: Record<string, string> | null;
    }): Promise<StudioSettings & { success: boolean }> => core.post("/studio/settings", payload),

    getStudioDiagnostics: (): Promise<StudioDiagnostics> => core.get("/studio/diagnostics"),

    getStudioStorage: (): Promise<StorageInfo> => core.get("/studio/storage"),

    getModelIndex: async (options?: RequestOptions): Promise<ModelIndexResponse> => {
      try {
        return await core.get("/studio/model-index", options);
      } catch (error) {
        if (!hasStatus(error, 404)) throw error;
        return bundledModelIndex;
      }
    },

    getStarterPresets: (): Promise<{
      presets: StarterPreset[];
      max_vram_gb: number;
    }> => core.get("/studio/presets"),

    getDownloads: (): Promise<{ downloads: ModelDownload[] }> => core.get("/studio/downloads"),

    startDownload: (params: {
      model_id: string;
      revision?: string;
      destination_dir?: string;
      allow_patterns?: string[];
      ignore_patterns?: string[];
      hf_token?: string;
    }): Promise<{ download: ModelDownload }> =>
      core.post("/studio/downloads", params, { timeout: 120_000, retries: 0 }),

    pauseDownload: (id: string): Promise<{ download: ModelDownload }> =>
      core.post(`/studio/downloads/${encodePathSegments(id)}/pause`),

    resumeDownload: (id: string, hfToken?: string): Promise<{ download: ModelDownload }> =>
      core.post(`/studio/downloads/${encodePathSegments(id)}/resume`, {
        ...(hfToken ? { hf_token: hfToken } : {}),
      }),

    cancelDownload: (id: string): Promise<{ download: ModelDownload }> =>
      core.post(`/studio/downloads/${encodePathSegments(id)}/cancel`),

    deleteModel: (path: string): Promise<{ success: boolean }> =>
      core.post("/studio/models/delete", { path }),

    moveModel: (
      sourcePath: string,
      targetRoot: string,
    ): Promise<{ success: boolean; target: string }> =>
      core.post("/studio/models/move", { source_path: sourcePath, target_root: targetRoot }),

    getProviders: (): Promise<{
      providers: Array<{
        id: string;
        name: string;
        base_url: string;
        enabled: boolean;
        has_api_key: boolean;
      }>;
    }> => core.get("/studio/providers"),

    createProvider: (payload: {
      id: string;
      name: string;
      base_url: string;
      api_key: string;
      enabled?: boolean;
    }): Promise<{
      success: boolean;
      provider: {
        id: string;
        name: string;
        base_url: string;
        enabled: boolean;
        has_api_key: boolean;
      };
    }> => core.post("/studio/providers", payload),

    updateProvider: (
      id: string,
      payload: {
        name?: string;
        base_url?: string;
        api_key?: string;
        enabled?: boolean;
      },
    ): Promise<{
      success: boolean;
      provider: {
        id: string;
        name: string;
        base_url: string;
        enabled: boolean;
        has_api_key: boolean;
      };
    }> => core.put(`/studio/providers/${encodePathSegments(id)}`, payload),

    deleteProvider: (id: string): Promise<{ success: boolean }> =>
      core.delete(`/studio/providers/${encodePathSegments(id)}`),

    getProviderModels: (): Promise<{
      providers: Array<{
        provider: string;
        models: Array<{ id: string; name?: string }>;
      }>;
    }> => core.get("/studio/provider-models"),

    getVllmRuntime: (): Promise<VllmRuntimeInfo> => core.get("/runtime/vllm"),

    getRuntimeTargets: (): Promise<{ targets: RuntimeTarget[] }> => core.get("/runtime/targets"),

    createRuntimeJob: (payload: {
      backend: "vllm" | "sglang" | "llamacpp" | "mlx";
      targetId?: string;
      type?: "install" | "update" | "download" | "inspect";
      command?: string;
      args?: string[];
      version?: string;
      preferBundled?: boolean;
    }): Promise<{ job: EngineJob }> =>
      core.post("/runtime/jobs", {
        backend: payload.backend,
        targetId: payload.targetId,
        type: payload.type,
        command: payload.command,
        args: payload.args,
        version: payload.version,
        prefer_bundled: payload.preferBundled,
      }),

    getRuntimeJobs: (): Promise<{ jobs: EngineJob[] }> => core.get("/runtime/jobs"),

    getRuntimeJob: (id: string): Promise<{ job: EngineJob }> =>
      core.get(`/runtime/jobs/${encodePathSegments(id)}`),

    cancelRuntimeJob: (id: string): Promise<{ job: EngineJob }> =>
      core.post(`/runtime/jobs/${encodePathSegments(id)}/cancel`),

    getVllmRuntimeConfig: (): Promise<VllmRuntimeConfig> => core.get("/runtime/vllm/config"),

    getSglangRuntime: (): Promise<RuntimeBackendInfo> => core.get("/runtime/sglang"),

    getLlamacppRuntime: (): Promise<RuntimeBackendInfo> => core.get("/runtime/llamacpp"),

    getMlxRuntime: (): Promise<RuntimeBackendInfo> => core.get("/runtime/mlx"),

    getLlamacppRuntimeConfig: (): Promise<{ config: string | null; error?: string | null }> =>
      core.get("/runtime/llamacpp/config"),

    getCudaRuntime: (): Promise<RuntimeCudaInfo> => core.get("/runtime/cuda"),

    getRocmRuntime: (): Promise<RuntimeRocmInfo> => core.get("/runtime/rocm"),

    upgradeRuntime: (
      backend: "vllm" | "sglang" | "llamacpp" | "mlx" | "cuda" | "rocm",
      payload: { preferBundled?: boolean; version?: string; targetId?: string } = {},
    ): Promise<RuntimeJobResponse> =>
      core.post(`/runtime/${backend}/upgrade`, {
        prefer_bundled: payload.preferBundled,
        version: payload.version,
        targetId: payload.targetId,
      }),
  };
}
