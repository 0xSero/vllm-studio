import { getControllerApiKey } from "./controllers";
import { getStoredBackendUrl } from "./backend-url";

/**
 * API key management utilities
 */

let runtimeApiKey = "";

/**
 * Get the API key from the active browser/controller state.
 *
 * Do not read NEXT_PUBLIC_* here. This module is bundled into the renderer,
 * so public env values become compiled defaults and can outlive key rotation.
 */
export function getApiKey(): string {
  if (runtimeApiKey) return runtimeApiKey;

  if (typeof window !== "undefined") {
    return getControllerApiKey(getStoredBackendUrl());
  }

  return process.env.VLLM_STUDIO_API_KEY?.trim() || "";
}

/**
 * Save API key only for the current browser runtime.
 */
export function setApiKey(key: string): void {
  runtimeApiKey = key.trim();
}

/**
 * Remove the in-memory runtime API key.
 */
export function clearApiKey(): void {
  runtimeApiKey = "";
}
