const CONTROLLERS_STORAGE_KEY = "vllm-studio.controllers";

export type SavedController = {
  url: string;
  apiKey?: string;
};

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function parseSavedController(entry: unknown): SavedController | null {
  if (typeof entry === "string") {
    const url = normalizeUrl(entry);
    return url ? { url } : null;
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const url = typeof record.url === "string" ? normalizeUrl(record.url) : "";
  if (!url) return null;
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  return apiKey ? { url, apiKey } : { url };
}

export function loadSavedControllers(): SavedController[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CONTROLLERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const byUrl = new Map<string, SavedController>();
    for (const entry of parsed) {
      const controller = parseSavedController(entry);
      if (!controller) continue;
      byUrl.set(controller.url, { ...byUrl.get(controller.url), ...controller });
    }
    return [...byUrl.values()];
  } catch {
    return [];
  }
}

export function saveSavedControllers(controllers: SavedController[]): SavedController[] {
  if (typeof window === "undefined") return [];
  const byUrl = new Map<string, SavedController>();
  for (const controller of controllers) {
    const url = normalizeUrl(controller.url);
    if (!url) continue;
    const apiKey = controller.apiKey?.trim();
    byUrl.set(url, apiKey ? { url, apiKey } : { url });
  }
  const next = [...byUrl.values()];
  window.localStorage.setItem(CONTROLLERS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("storage"));
  return next;
}

export function getControllerApiKey(url: string): string {
  const normalized = normalizeUrl(url);
  if (!normalized) return "";
  return (
    loadSavedControllers().find((controller) => normalizeUrl(controller.url) === normalized)
      ?.apiKey ?? ""
  );
}
