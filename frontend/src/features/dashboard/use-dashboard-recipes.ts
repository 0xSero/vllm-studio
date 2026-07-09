import { useCallback, useState } from "react";
import { createApiClient } from "@/lib/api/create-api-client";
import { BACKEND_URL_CHANGED_EVENT, getApiKey, getStoredBackendUrl } from "@/lib/api/connection";
import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { effectInterval } from "@/lib/effect-timers";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

function processKey(process: ProcessInfo | null): string {
  if (!process) return "";
  return [
    process.pid,
    process.backend,
    process.served_model_name ?? "",
    process.model_path ?? "",
  ].join("|");
}

let lastRecipe: RecipeWithStatus | null = null;
let lastRecipeProcessKey = "";
const FAST_LOG_REQUEST = { timeout: 3_000, retries: 0 } as const;

type DashboardRecipesCache = {
  currentRecipe: RecipeWithStatus | null;
  logs: string[];
  processKey: string;
  recipes: RecipeWithStatus[];
};

type DashboardApi = ReturnType<typeof createApiClient>;

const cacheByController = new Map<string, DashboardRecipesCache>();

function controllerKey(): string {
  return getStoredBackendUrl() || "default";
}

function apiForController(key: string): DashboardApi {
  const apiKey = getApiKey();
  return createApiClient({
    baseUrl: "/api/proxy",
    useProxy: true,
    backendUrlOverride: key === "default" ? undefined : key,
    ...(apiKey ? { apiKeyOverride: apiKey } : {}),
  });
}

function cacheState(
  key: string,
  process: ProcessInfo | null,
  recipes: RecipeWithStatus[],
  currentRecipe: RecipeWithStatus | null,
  logs: string[],
): void {
  cacheByController.set(key, {
    currentRecipe,
    logs,
    processKey: processKey(process),
    recipes,
  });
}

function cachedState(key: string): DashboardRecipesCache | null {
  return cacheByController.get(key) ?? null;
}

export function useDashboardRecipes(currentProcess: ProcessInfo | null) {
  const initialCache = cachedState(controllerKey());
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>(() => initialCache?.recipes ?? []);
  const [currentRecipe, setCurrentRecipe] = useState<RecipeWithStatus | null>(
    () =>
      initialCache?.currentRecipe ??
      (lastRecipe && lastRecipeProcessKey === processKey(currentProcess) ? lastRecipe : null),
  );
  const [logs, setLogs] = useState<string[]>(() => initialCache?.logs ?? []);
  const [loading, setLoading] = useState(!initialCache);

  const applyCachedState = useCallback((key: string) => {
    const cached = cachedState(key);
    setRecipes(cached?.recipes ?? []);
    setCurrentRecipe(cached?.currentRecipe ?? null);
    setLogs(cached?.logs ?? []);
    setLoading(!cached);
  }, []);

  const selectTargetLogSession = useCallback(
    (
      sessions: Array<{
        id: string;
        recipe_id?: string;
        status: string;
        backend?: string;
        model_path?: string;
        model?: string;
        started_at?: string;
        created_at?: string;
      }>,
      runningRecipe: RecipeWithStatus | null,
    ) => {
      if (sessions.length === 0) return null;

      // Sort newest-first so we always prefer the most recently started session.
      const ts = (s: { started_at?: string; created_at?: string }) =>
        Date.parse(s.started_at || s.created_at || "") || 0;
      const sorted = [...sessions].sort((a, b) => ts(b) - ts(a));
      const running = sorted.filter((s) => s.status === "running");

      if (currentProcess) {
        const matches = (session: (typeof sorted)[number]) => {
          if (session.model_path && currentProcess.model_path) {
            return session.model_path === currentProcess.model_path;
          }
          if (session.model && currentProcess.served_model_name) {
            return session.model === currentProcess.served_model_name;
          }
          return session.backend === currentProcess.backend;
        };
        const byProcess = running.find(matches) || sorted.find(matches);
        if (byProcess) return byProcess;

        const servedModel = currentProcess.served_model_name?.toLowerCase();
        if (servedModel) {
          const byName = sorted.find((session) =>
            (session.id ?? "").toLowerCase().includes(servedModel),
          );
          if (byName) return byName;
        }
      }

      if (runningRecipe) {
        const byRecipe =
          running.find((s) => s.recipe_id === runningRecipe.id) ||
          sorted.find((s) => s.recipe_id === runningRecipe.id);
        if (byRecipe) return byRecipe;
      }

      // Fall back to newest running, then newest of any status.
      return running[0] || sorted[0];
    },
    [currentProcess],
  );

  const refreshLogs = useCallback(
    async (client: DashboardApi, runningRecipe: RecipeWithStatus | null, limit = 220) => {
      const sessions = await client.getLogSessions(FAST_LOG_REQUEST);
      const list = sessions.sessions || [];
      if (list.length === 0) return [];
      const targetSession = selectTargetLogSession(list, runningRecipe);
      if (!targetSession) return [];
      const logData = await client
        .getLogs(targetSession.id, limit, FAST_LOG_REQUEST)
        .catch(() => ({ logs: [] }));
      return logData.logs || [];
    },
    [selectTargetLogSession],
  );

  const reload = useCallback(
    async (targetKey = controllerKey()) => {
      const client = apiForController(targetKey);
      try {
        const data = await client.getRecipes();
        if (controllerKey() !== targetKey) return;
        const list = data.recipes || [];
        setRecipes(list);

        const running = currentProcess
          ? list.find((r: RecipeWithStatus) => r.status === "running") || null
          : null;
        const resolved = running ?? (currentProcess ? currentRecipe : null);
        setCurrentRecipe(resolved);
        const key = processKey(currentProcess);
        lastRecipe = resolved && key ? resolved : null;
        lastRecipeProcessKey = resolved && key ? key : "";
        const nextLogs = await refreshLogs(client, resolved);
        if (controllerKey() !== targetKey) return;
        setLogs(nextLogs);
        cacheState(targetKey, currentProcess, list, resolved, nextLogs);
      } catch (e) {
        console.error("Failed to load recipes:", e);
      } finally {
        if (controllerKey() === targetKey) setLoading(false);
      }
    },
    [currentProcess, currentRecipe, refreshLogs],
  );

  useMountSubscription(() => {
    void reload();
  }, [reload]);
  useMountSubscription(() => {
    const handler = () => {
      void reload();
    };
    window.addEventListener("vllm:recipe-event", handler as EventListener);
    return () => {
      window.removeEventListener("vllm:recipe-event", handler as EventListener);
    };
  }, [reload]);
  useMountSubscription(() => {
    const handler = () => {
      const key = controllerKey();
      applyCachedState(key);
      void reload(key);
    };
    window.addEventListener(BACKEND_URL_CHANGED_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(BACKEND_URL_CHANGED_EVENT, handler as EventListener);
    };
  }, [applyCachedState, reload]);
  useMountSubscription(() => {
    if (!currentProcess) return;
    let cancelled = false;
    const targetKey = controllerKey();
    const client = apiForController(targetKey);
    const poll = async () => {
      if (cancelled) return;
      const nextLogs = await refreshLogs(client, currentRecipe).catch(() => []);
      if (cancelled || controllerKey() !== targetKey) return;
      setLogs(nextLogs);
      cacheState(targetKey, currentProcess, recipes, currentRecipe, nextLogs);
    };
    void poll();
    const timer = effectInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      timer.cancel();
    };
  }, [currentProcess, currentRecipe, recipes, refreshLogs]);

  return { recipes, currentRecipe, logs, loading, reload };
}
