import { Schema } from "effect";
import {
  ModelIndexSchema,
  bundledModelIndexSource,
  type ModelIndexResponse,
} from "@local-studio/contracts/model-index";
import type {
  RuntimeJobBackend,
  RuntimeJobResponse,
  RuntimeJobsResponse,
  RuntimeTargetsResponse,
  RuntimeJobType,
  RuntimeUpgradeResponse,
  VllmRuntimeInfo,
} from "@local-studio/contracts/system";
import type {
  StudioProviderModelsResponse,
  StudioProviderMutationResponse,
  StudioProviderCreate,
  StudioProvidersResponse,
  StudioProviderUpdate,
  StudioSettingsUpdate,
  StudioSettingsUpdateResponse,
} from "@local-studio/contracts/studio";
import type {
  ModelDownload,
  ModelInfo,
  StarterPreset,
  StorageInfo,
  StudioDiagnostics,
  StudioSettings,
  RuntimeBackendInfo,
  RuntimeCudaInfo,
  RuntimeRocmInfo,
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

export interface VllmRuntimeConfig {
  config: string | null;
  error?: string | null;
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
    }> => core.request("/v1/studio/models"),

    getStudioSettings: (options?: RequestOptions): Promise<StudioSettings> =>
      core.rpcJson(core.rpc.studio.settings.$get(undefined, { init: options })),

    updateStudioSettings: (payload: StudioSettingsUpdate): Promise<StudioSettingsUpdateResponse> =>
      core.rpcJson(core.rpc.studio.settings.$post({ json: payload })),

    getStudioDiagnostics: (): Promise<StudioDiagnostics> =>
      core.rpcJson(core.rpc.studio.diagnostics.$get()),

    getStudioStorage: (): Promise<StorageInfo> => core.rpcJson(core.rpc.studio.storage.$get()),

    getModelIndex: async (options?: RequestOptions): Promise<ModelIndexResponse> => {
      try {
        return await core.rpcJson<ModelIndexResponse>(
          core.rpc.studio["model-index"].$get(undefined, { init: options }),
        );
      } catch (error) {
        if (!hasStatus(error, 404)) throw error;
        return bundledModelIndex;
      }
    },

    getStarterPresets: (): Promise<{
      presets: StarterPreset[];
      max_vram_gb: number;
    }> => core.rpcJson(core.rpc.studio.presets.$get()),

    getDownloads: (): Promise<{ downloads: ModelDownload[] }> => core.request("/studio/downloads"),

    startDownload: (params: {
      model_id: string;
      revision?: string;
      destination_dir?: string;
      allow_patterns?: string[];
      ignore_patterns?: string[];
      hf_token?: string;
    }): Promise<{ download: ModelDownload }> =>
      core.request("/studio/downloads", {
        method: "POST",
        body: JSON.stringify(params),
        timeout: 120_000,
        retries: 0,
      }),

    pauseDownload: (id: string): Promise<{ download: ModelDownload }> =>
      core.request(`/studio/downloads/${encodePathSegments(id)}/pause`, { method: "POST" }),

    resumeDownload: (id: string, hfToken?: string): Promise<{ download: ModelDownload }> =>
      core.request(`/studio/downloads/${encodePathSegments(id)}/resume`, {
        method: "POST",
        body: hfToken ? JSON.stringify({ hf_token: hfToken }) : "{}",
      }),

    cancelDownload: (id: string): Promise<{ download: ModelDownload }> =>
      core.request(`/studio/downloads/${encodePathSegments(id)}/cancel`, { method: "POST" }),

    deleteModel: (path: string): Promise<{ success: boolean }> =>
      core.request("/studio/models/delete", { method: "POST", body: JSON.stringify({ path }) }),

    moveModel: (
      sourcePath: string,
      targetRoot: string,
    ): Promise<{ success: boolean; target: string }> =>
      core.request("/studio/models/move", {
        method: "POST",
        body: JSON.stringify({ source_path: sourcePath, target_root: targetRoot }),
      }),

    getProviders: (): Promise<StudioProvidersResponse> =>
      core.rpcJson(core.rpc.studio.providers.$get()),

    createProvider: (payload: StudioProviderCreate): Promise<StudioProviderMutationResponse> =>
      core.rpcJson(core.rpc.studio.providers.$post({ json: payload })),

    updateProvider: (
      id: string,
      payload: StudioProviderUpdate,
    ): Promise<StudioProviderMutationResponse> =>
      core.rpcJson(
        core.rpc.studio.providers[":id"].$put({
          param: { id: encodePathSegments(id) },
          json: payload,
        }),
      ),

    deleteProvider: (id: string): Promise<{ success: boolean }> =>
      core.rpcJson(
        core.rpc.studio.providers[":id"].$delete({ param: { id: encodePathSegments(id) } }),
      ),

    getProviderModels: (): Promise<StudioProviderModelsResponse> =>
      core.rpcJson(core.rpc.studio["provider-models"].$get()),

    getVllmRuntime: (): Promise<VllmRuntimeInfo> => core.rpcJson(core.rpc.runtime.vllm.$get()),

    getRuntimeTargets: (): Promise<RuntimeTargetsResponse> =>
      core.rpcJson(core.rpc.runtime.targets.$get()),

    createRuntimeJob: (payload: {
      backend: RuntimeJobBackend;
      targetId?: string;
      type?: RuntimeJobType;
      command?: string;
      args?: string[];
      version?: string;
      preferBundled?: boolean;
    }): Promise<RuntimeJobResponse> =>
      core.rpcJson(
        core.rpc.runtime.jobs.$post({
          json: {
            backend: payload.backend,
            targetId: payload.targetId,
            type: payload.type,
            command: payload.command,
            args: payload.args,
            version: payload.version,
            prefer_bundled: payload.preferBundled,
          },
        }),
      ),

    getRuntimeJobs: (): Promise<RuntimeJobsResponse> => core.rpcJson(core.rpc.runtime.jobs.$get()),

    getRuntimeJob: (id: string): Promise<RuntimeJobResponse> =>
      core.rpcJson(
        core.rpc.runtime.jobs[":jobId"].$get({ param: { jobId: encodePathSegments(id) } }),
      ),

    cancelRuntimeJob: (id: string): Promise<RuntimeJobResponse> =>
      core.rpcJson(
        core.rpc.runtime.jobs[":jobId"].cancel.$post({
          param: { jobId: encodePathSegments(id) },
        }),
      ),

    getVllmRuntimeConfig: (): Promise<VllmRuntimeConfig> => core.request("/runtime/vllm/config"),

    getSglangRuntime: (): Promise<RuntimeBackendInfo> =>
      core.rpcJson(core.rpc.runtime.sglang.$get()),

    getLlamacppRuntime: (): Promise<RuntimeBackendInfo> =>
      core.rpcJson(core.rpc.runtime.llamacpp.$get()),

    getMlxRuntime: (): Promise<RuntimeBackendInfo> => core.rpcJson(core.rpc.runtime.mlx.$get()),

    getLlamacppRuntimeConfig: (): Promise<{ config: string | null; error?: string | null }> =>
      core.request("/runtime/llamacpp/config"),

    getCudaRuntime: (): Promise<RuntimeCudaInfo> => core.rpcJson(core.rpc.runtime.cuda.$get()),

    getRocmRuntime: (): Promise<RuntimeRocmInfo> => core.rpcJson(core.rpc.runtime.rocm.$get()),

    upgradeRuntime: (
      backend: "vllm" | "sglang" | "llamacpp" | "mlx" | "cuda" | "rocm",
      payload: { preferBundled?: boolean; version?: string; targetId?: string } = {},
    ): Promise<RuntimeUpgradeResponse> =>
      core.rpcJson(
        core.rpc.runtime[":backend"].upgrade.$post({
          param: { backend },
          json: {
            prefer_bundled: payload.preferBundled,
            version: payload.version,
            targetId: payload.targetId,
          },
        }),
      ),
  };
}
