import { AsyncLock, delay } from "../../core/async";
import { primaryLogPathFor, readFileTailBytes } from "../../core/log-files";
import type { EventManager } from "../system/event-manager";
import { pidExists } from "./process/process-utilities";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import type { ProcessInfo, Recipe } from "../models/types";
import type { Config } from "../../config/env";
import type { ProcessManager } from "./process/process-manager";
import type { RecipeStore } from "../models/recipes/recipe-store";
import { LIFECYCLE_READY_TIMEOUT_MS } from "./configs";
import type {
  EngineService,
  DownloadRequest,
  SetActiveRecipeResult,
  SetActiveRecipeOptions,
} from "./engine-service";
import type { ModelDownload } from "../shared/recipe-types";
import type { DownloadManager } from "./downloads/download-manager";
import type { LaunchFailureBudget } from "./process/launch-failure-budget";
import { formatLaunchFailureBudgetMessage } from "./process/launch-failure-budget";
import { getEngineSpec } from "./engine-spec";
interface CoordinatorDeps {
  config: Config;
  eventManager: EventManager;
  processManager: ProcessManager;
  recipeStore: RecipeStore;
  downloadManager: DownloadManager;
  launchFailureBudget: LaunchFailureBudget;
}
export class EngineCoordinator implements EngineService {
  private readonly switchLock = new AsyncLock();
  private activeLifecycleAbort: AbortController | null = null;
  private activeLaunchPid: number | null = null;
  private lifecycleIntentSerial = 0;
  constructor(private readonly deps: CoordinatorDeps) {}

  async setActiveRecipe(
    recipe: Recipe | null,
    options: SetActiveRecipeOptions = {}
  ): Promise<SetActiveRecipeResult> {
    const intentSerial = ++this.lifecycleIntentSerial;
    if (!recipe) {
      this.activeLifecycleAbort?.abort();
      if (this.activeLaunchPid) {
        await this.deps.processManager.killProcess(this.activeLaunchPid, true);
      }
    }
    const release = await this.switchLock.acquire();
    let spawnedPid: number | null = null;
    let cancelled = false;
    const lifecycleAbort = recipe ? new AbortController() : null;
    const abortLifecycle = (): void => lifecycleAbort?.abort();
    if (lifecycleAbort) {
      if (options.signal?.aborted) lifecycleAbort.abort();
      options.signal?.addEventListener("abort", abortLifecycle, { once: true });
      this.activeLifecycleAbort = lifecycleAbort;
    }
    const isAborted = (): boolean =>
      Boolean(lifecycleAbort?.signal.aborted || intentSerial !== this.lifecycleIntentSerial);
    const publishCancelled = async (targetRecipe: Recipe): Promise<SetActiveRecipeResult> => {
      if (cancelled) return { ok: false, error: "Launch cancelled" };
      cancelled = true;
      if (spawnedPid) {
        await this.deps.processManager.killProcess(spawnedPid, true);
      }
      await this.deps.eventManager.publishLaunchProgress(
        targetRecipe.id,
        "cancelled",
        "Launch cancelled",
        0
      );
      return { ok: false, error: "Launch cancelled" };
    };
    const abortIfNeeded = async (
      targetRecipe: Recipe | null
    ): Promise<SetActiveRecipeResult | null> => {
      if (!isAborted()) return null;
      if (!targetRecipe) return null;
      return publishCancelled(targetRecipe);
    };
    try {
      if (recipe && intentSerial !== this.lifecycleIntentSerial) {
        return { ok: false, error: "Launch cancelled" };
      }
      const current = await this.deps.processManager.findInferenceProcess(
        this.deps.config.inference_port
      );
      const initialAbort = await abortIfNeeded(recipe);
      if (initialAbort) return initialAbort;
      if (!recipe && !current) {
        return { ok: true };
      }
      if (recipe && current && isRecipeRunning(recipe, current)) {
        return { ok: true };
      }
      const killCurrent = async (process: ProcessInfo): Promise<boolean> => {
        const evictedRecipe = this.findRecipeForProcess(process);
        if (evictedRecipe) {
          await this.deps.eventManager.publishLaunchProgress(
            evictedRecipe.id,
            "stopping",
            `Stopping ${evictedRecipe.name}...`,
            0.1
          );
        }
        const stopped = await this.deps.processManager.killProcess(process.pid, true);
        if (evictedRecipe) {
          await this.deps.eventManager.publishLaunchProgress(
            evictedRecipe.id,
            stopped ? "stopped" : "error",
            stopped ? "Model stopped" : "Model did not stop cleanly",
            stopped ? 1 : 0
          );
        }
        return stopped;
      };
      if (current && (!recipe || !isRecipeRunning(recipe, current))) {
        const stopped = await killCurrent(current);
        if (!stopped) {
          return { ok: false, error: `Failed to stop process ${current.pid}` };
        }
        await delay(500);
      }
      const postEvictAbort = await abortIfNeeded(recipe);
      if (postEvictAbort) return postEvictAbort;
      if (!recipe) {
        return { ok: true };
      }
      const blocked = this.deps.launchFailureBudget.isBlocked(recipe.id);
      if (blocked) {
        const message = formatLaunchFailureBudgetMessage(blocked);
        await this.deps.eventManager.publishLaunchProgress(recipe.id, "error", message, 0);
        return { ok: false, error: message };
      }
      await this.deps.eventManager.publishLaunchProgress(
        recipe.id,
        "launching",
        `Starting ${recipe.name}...`,
        0.25
      );
      const launch = await this.deps.processManager.launchModel(recipe);
      spawnedPid = launch.pid;
      this.activeLaunchPid = launch.pid;
      if (!launch.success) {
        const failure = this.deps.launchFailureBudget.recordFailure(recipe.id);
        await this.deps.eventManager.publishLaunchProgress(
          recipe.id,
          "error",
          `${launch.message} (${failure.failure_count}/${failure.limit} launch failures in the current window)`,
          0
        );
        return { ok: false, error: launch.message };
      }
      const postLaunchAbort = await abortIfNeeded(recipe);
      if (postLaunchAbort) return postLaunchAbort;
      await this.deps.eventManager.publishLaunchProgress(
        recipe.id,
        "waiting",
        "Loading model... (0s)",
        0.5
      );
      const waitOptions: Parameters<typeof this.waitForReady>[0] = {
        recipe,
        pid: launch.pid,
        logFilePath: launch.log_file ?? primaryLogPathFor(this.deps.config.data_dir, recipe.id),
        timeoutMs: LIFECYCLE_READY_TIMEOUT_MS,
      };
      if (lifecycleAbort) {
        waitOptions.cancel = lifecycleAbort.signal;
      }
      const ready = await this.waitForReady(waitOptions);
      if (isAborted()) {
        return publishCancelled(recipe);
      }
      if (ready.ready) {
        this.deps.launchFailureBudget.reset(recipe.id);
        await this.deps.eventManager.publishLaunchProgress(
          recipe.id,
          "ready",
          "Model is ready!",
          1
        );
        return { ok: true };
      }
      if (launch.pid) {
        await this.deps.processManager.killProcess(launch.pid, true);
      }
      const failure = this.deps.launchFailureBudget.recordFailure(recipe.id);
      await this.deps.eventManager.publishLaunchProgress(
        recipe.id,
        "error",
        `${ready.message} (${failure.failure_count}/${failure.limit} launch failures in the current window)`,
        0
      );
      return { ok: false, error: ready.message };
    } finally {
      if (this.activeLifecycleAbort === lifecycleAbort) {
        this.activeLifecycleAbort = null;
      }
      if (this.activeLaunchPid === spawnedPid) {
        this.activeLaunchPid = null;
      }
      options.signal?.removeEventListener("abort", abortLifecycle);
      release();
    }
  }
  private async waitForReady(options: {
    recipe: Recipe;
    pid: number | null;
    logFilePath: string | null;
    cancel?: AbortSignal;
    timeoutMs?: number;
    fatalPatterns?: string[];
    onProgress?: (elapsedSeconds: number) => Promise<void>;
  }): Promise<{ ready: true } | { ready: false; message: string }> {
    const timeout = options.timeoutMs ?? LIFECYCLE_READY_TIMEOUT_MS;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (options.cancel?.aborted) {
        return { ready: false, message: "Launch cancelled" };
      }
      if (options.pid && !pidExists(options.pid)) {
        const errorTail = options.logFilePath ? readFileTailBytes(options.logFilePath, 500) : "";
        return {
          ready: false,
          message: `Model ${options.recipe.id} crashed during startup: ${errorTail.slice(-200)}`,
        };
      }
      if (options.logFilePath && options.fatalPatterns && options.fatalPatterns.length > 0) {
        const logTail = readFileTailBytes(options.logFilePath, 3000);
        for (const pattern of options.fatalPatterns) {
          if (!logTail.includes(pattern)) continue;
          const lines = logTail.split("\n");
          const index = lines.findIndex((line) => line.includes(pattern));
          const snippet =
            index >= 0 ? lines.slice(Math.max(0, index - 1), index + 3).join("\n") : pattern;
          return { ready: false, message: `Fatal error: ${snippet.slice(0, 300)}` };
        }
      }
      try {
        const { fetchLocal } = await import("../../http/local-fetch");
        const healthPath = getEngineSpec(options.recipe.backend).healthPath;
        const response = await fetchLocal(this.deps.config.inference_port, healthPath, {
          host: this.deps.config.inference_host,
          timeoutMs: 5000,
        });
        if (response.status === 200) {
          return { ready: true };
        }
      } catch {}
      const elapsedSeconds = Math.floor((Date.now() - start) / 1000);
      if (options.onProgress) {
        await options.onProgress(elapsedSeconds);
      }
      await delay(2000);
    }
    return {
      ready: false,
      message: `Model ${options.recipe.id} failed to become ready (timeout)`,
    };
  }
  private findRecipeForProcess(current: ProcessInfo): Recipe | null {
    for (const candidate of this.deps.recipeStore.list()) {
      if (isRecipeRunning(candidate, current, { allowEitherPathContains: true })) {
        return candidate;
      }
    }
    return null;
  }
  resetLaunchFailureBudget(recipeId: string): void {
    this.deps.launchFailureBudget.reset(recipeId);
  }

  async getCurrentProcess(): Promise<ProcessInfo | null> {
    return this.deps.processManager.findInferenceProcess(this.deps.config.inference_port);
  }

  async startDownload(request: DownloadRequest): Promise<ModelDownload> {
    return await this.deps.downloadManager.start(request);
  }

  pauseDownload(downloadId: string): ModelDownload {
    return this.deps.downloadManager.pause(downloadId);
  }

  resumeDownload(downloadId: string, hfToken?: string | null): ModelDownload {
    return this.deps.downloadManager.resume(downloadId, hfToken ?? null);
  }

  cancelDownload(downloadId: string): ModelDownload {
    return this.deps.downloadManager.cancel(downloadId);
  }
  listDownloads(): ModelDownload[] {
    return this.deps.downloadManager.list();
  }

  getDownload(downloadId: string): ModelDownload | null {
    return this.deps.downloadManager.get(downloadId);
  }

}
export const createEngineCoordinator = (deps: CoordinatorDeps): EngineCoordinator => {
  return new EngineCoordinator(deps);
};
