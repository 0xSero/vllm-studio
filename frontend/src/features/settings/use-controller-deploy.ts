"use client";

import { useRef, useState } from "react";
import {
  loadSavedControllers,
  normalizeControllerUrl,
  saveSavedControllers,
  type SavedController,
} from "@/lib/api/controllers";
import { setApiKey, setStoredBackendUrl } from "@/lib/api/connection";

export interface ControllerDeployBridge {
  start(options: {
    mode?: "ssh" | "local";
    host?: string;
    port?: number;
  }): Promise<{ ok: boolean; url?: string; apiKey?: string; error?: string }>;
  onLog(listener: (line: string) => void): () => void;
}

/**
 * Save an installed controller and make it the active one, the same writes the
 * settings page performs: the saved list, the stored backend URL, the runtime
 * key, and the server-side settings cookie.
 */
export const adoptDeployedController = async (controller: SavedController): Promise<void> => {
  const url = normalizeControllerUrl(controller.url);
  if (!url) return;
  const existing = loadSavedControllers();
  if (!existing.some((entry) => normalizeControllerUrl(entry.url) === url)) {
    saveSavedControllers([...existing, { ...controller, url }]);
  }
  setApiKey(controller.apiKey ?? "");
  setStoredBackendUrl(url);
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backendUrl: url, apiKey: controller.apiKey ?? "" }),
    });
  } catch {
    // The client-side writes above already point the app at the controller.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("storage"));
};

/**
 * One in-flight deploy, shared by the settings panel and the setup gate:
 * streamed installer lines, terminal error or success, and the resulting
 * controller handed to the caller.
 */
export function useControllerDeploy() {
  const bridge =
    typeof window === "undefined"
      ? null
      : ((
          window as unknown as {
            localStudioDesktop?: { controllerDeploy?: ControllerDeployBridge };
          }
        ).localStudioDesktop?.controllerDeploy ?? null);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const run = async (
    options: { mode?: "ssh" | "local"; host?: string },
    name: string,
  ): Promise<SavedController | null> => {
    if (!bridge || running) return null;
    setRunning(true);
    setError(null);
    setDone(null);
    setLines([]);
    unsubscribeRef.current?.();
    unsubscribeRef.current = bridge.onLog((line) =>
      setLines((current) => [...current.slice(-40), line]),
    );
    try {
      const result = await bridge.start(options);
      if (result.ok && result.url) {
        setDone(`Controller running at ${result.url} — added to your list.`);
        return { url: result.url, apiKey: result.apiKey, name };
      }
      setError(result.error ?? "Deploy failed");
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deploy failed");
      return null;
    } finally {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setRunning(false);
    }
  };

  return { available: Boolean(bridge), running, lines, error, done, run };
}
