export const SELECTED_PROJECT_KEY = "vllm-studio.agent.selectedProjectId";

export function readSelectedProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function writeSelectedProjectId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(SELECTED_PROJECT_KEY, id);
    else window.localStorage.removeItem(SELECTED_PROJECT_KEY);
  } catch {
    // Ignore storage failures; selection persists in memory.
  }
}
