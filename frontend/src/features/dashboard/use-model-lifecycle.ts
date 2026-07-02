"use client";

import { useCallback, useMemo, useState } from "react";
import api from "@/lib/api/client";
import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { isActiveLaunchStage } from "@/hooks/realtime-status-types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { BACKEND_URL_CHANGED_EVENT } from "@/lib/api/connection";

type ModelLifecycleStatus = "idle" | "starting" | "ready" | "error";

interface ModelLifecycle {
  activeRecipeId: string | null;
  status: ModelLifecycleStatus;
  error: string | null;
  start: (recipeId: string) => Promise<void>;
  stop: () => Promise<void>;
}

const matchesProcess = (recipe: RecipeWithStatus, process: ProcessInfo): boolean => {
  if (recipe.model_path && process.model_path && recipe.model_path === process.model_path)
    return true;
  if (recipe.served_model_name && process.served_model_name) {
    return recipe.served_model_name === process.served_model_name;
  }
  return recipe.id === process.served_model_name;
};

export function useModelLifecycle(): ModelLifecycle {
  const realtime = useRealtimeStatusStore();
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useMountSubscription(() => {
    let cancelled = false;
    const loadRecipes = (): void => {
      api
        .getRecipes()
        .then((data) => {
          if (!cancelled) setRecipes(data.recipes || []);
        })
        .catch(() => {
          if (!cancelled) setRecipes([]);
        });
    };
    loadRecipes();
    // Recipes are per-controller; refetch on controller switch so activeRecipeId
    // isn't resolved against the previous controller's stale list.
    const onBackendChange = (): void => loadRecipes();
    window.addEventListener(BACKEND_URL_CHANGED_EVENT, onBackendChange);
    return () => {
      cancelled = true;
      window.removeEventListener(BACKEND_URL_CHANGED_EVENT, onBackendChange);
    };
  }, []);

  const activeRecipeId = useMemo(() => {
    const process = realtime.status?.process;
    if (!process) return null;
    return recipes.find((recipe) => matchesProcess(recipe, process))?.id ?? null;
  }, [realtime.status?.process, recipes]);

  const status = useMemo<ModelLifecycleStatus>(() => {
    const stage = realtime.launchProgress?.stage;
    if (realtime.status?.process) return "ready";
    if (isActiveLaunchStage(stage)) {
      return realtime.status?.launching ? "starting" : "idle";
    }
    if (stage === "error") return "error";
    return "idle";
  }, [realtime.launchProgress?.stage, realtime.status?.launching, realtime.status?.process]);

  const visibleError = status === "error" ? (realtime.launchProgress?.message ?? error) : error;

  const start = useCallback(async (recipeId: string) => {
    setError(null);
    try {
      await api.launch(recipeId);
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
    }
  }, []);

  const stop = useCallback(async () => {
    setError(null);
    try {
      await api.evict();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      throw new Error(message);
    }
  }, []);

  return {
    activeRecipeId,
    status,
    error: visibleError,
    start,
    stop,
  };
}
