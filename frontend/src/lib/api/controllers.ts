export const CONTROLLERS_STORAGE_KEY = "local-studio.controllers";
const LEGACY_CONTROLLERS_STORAGE_KEY = [["v", "llm-studio"].join(""), "controllers"].join(".");
export const CONTROLLERS_CHANGED_EVENT = "vllm:controllers-changed";
export const CONTROLLER_CREDENTIAL_PERSISTENCE_EVENT =
  "local-studio:controller-credential-persistence";

export type SavedController = {
  url: string;
  apiKey?: string;
  hasApiKey?: boolean;
  name?: string;
};

const runtimeControllerKeys = new Map<string, string>();
const credentialPersistence = new Map<string, ControllerCredentialPersistence>();

export type ControllerCredentialPersistence = {
  url: string;
  state: "pending" | "stored" | "removed" | "failed";
  detail: string;
};

const updateCredentialPersistence = (
  url: string,
  state: ControllerCredentialPersistence["state"],
  detail: string,
): void => {
  const persistence = { url, state, detail };
  credentialPersistence.set(url, persistence);
  window.dispatchEvent(
    new CustomEvent(CONTROLLER_CREDENTIAL_PERSISTENCE_EVENT, { detail: persistence }),
  );
};

export const getControllerCredentialPersistence = (
  url: string,
): ControllerCredentialPersistence | null =>
  credentialPersistence.get(normalizeControllerUrl(url)) ?? null;

export const subscribeControllerCredentialPersistence = (callback: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CONTROLLER_CREDENTIAL_PERSISTENCE_EVENT, callback);
  return () => window.removeEventListener(CONTROLLER_CREDENTIAL_PERSISTENCE_EVENT, callback);
};

const persistControllerCredential = (url: string, apiKey: string, attempt = 0): void => {
  if (!apiKey) return;
  runtimeControllerKeys.set(url, apiKey);
  updateCredentialPersistence(url, "pending", "Storing controller credential");
  void fetch("/api/settings/controller-credential", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backendUrl: url, apiKey }),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Controller credential persistence failed");
      updateCredentialPersistence(url, "stored", "Controller credential stored");
    })
    .catch(() => {
      if (attempt < 2) {
        window.setTimeout(() => persistControllerCredential(url, apiKey, attempt + 1), 250);
        return;
      }
      updateCredentialPersistence(
        url,
        "failed",
        "Controller credential is available only until this application exits",
      );
    });
};

export const removeControllerCredential = (url: string, attempt = 0): void => {
  const normalized = normalizeControllerUrl(url);
  if (!normalized) return;
  runtimeControllerKeys.delete(normalized);
  updateCredentialPersistence(normalized, "pending", "Removing controller credential");
  void fetch("/api/settings/controller-credential", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backendUrl: normalized, apiKey: "" }),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Controller credential removal failed");
      updateCredentialPersistence(normalized, "removed", "Controller credential removed");
    })
    .catch(() => {
      if (attempt < 2) {
        window.setTimeout(() => removeControllerCredential(normalized, attempt + 1), 250);
        return;
      }
      updateCredentialPersistence(
        normalized,
        "failed",
        "Controller metadata was removed but its durable credential could not be removed",
      );
    });
};

export function normalizeControllerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname.replace(/\/v1\/?$/i, "") || "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
  }
}

function parseSavedController(entry: unknown): SavedController | null {
  if (typeof entry === "string") {
    const url = normalizeControllerUrl(entry);
    return url ? { url } : null;
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const url = typeof record.url === "string" ? normalizeControllerUrl(record.url) : "";
  if (!url) return null;
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  const hasApiKey = record.hasApiKey === true || Boolean(apiKey);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const out: SavedController = { url };
  if (apiKey) persistControllerCredential(url, apiKey);
  if (hasApiKey) out.hasApiKey = true;
  if (name) out.name = name;
  return out;
}

export function loadSavedControllers(): SavedController[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.localStorage.getItem(CONTROLLERS_STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_CONTROLLERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const byUrl = new Map<string, SavedController>();
    for (const entry of parsed) {
      const controller = parseSavedController(entry);
      if (!controller) continue;
      byUrl.set(controller.url, { ...byUrl.get(controller.url), ...controller });
    }
    const next = [...byUrl.values()];
    if (
      JSON.stringify(parsed) !== JSON.stringify(next) ||
      !window.localStorage.getItem(CONTROLLERS_STORAGE_KEY)
    ) {
      window.localStorage.setItem(CONTROLLERS_STORAGE_KEY, JSON.stringify(next));
    }
    return next;
  } catch {
    return [];
  }
}

export function saveSavedControllers(controllers: SavedController[]): SavedController[] {
  if (typeof window === "undefined") return [];
  const byUrl = new Map<string, SavedController>();
  for (const controller of controllers) {
    const url = normalizeControllerUrl(controller.url);
    if (!url) continue;
    const apiKey = controller.apiKey?.trim() || runtimeControllerKeys.get(url);
    const name = controller.name?.trim();
    const out: SavedController = { url };
    if (apiKey) persistControllerCredential(url, apiKey);
    if (apiKey || controller.hasApiKey) out.hasApiKey = true;
    if (name) out.name = name;
    byUrl.set(url, out);
  }
  const next = [...byUrl.values()];
  window.localStorage.setItem(CONTROLLERS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent(CONTROLLERS_CHANGED_EVENT, { detail: { controllers: next } }),
  );
  window.dispatchEvent(new Event("storage"));
  return next;
}

export function getControllerApiKey(url: string): string {
  const normalized = normalizeControllerUrl(url);
  if (!normalized) return "";
  return (
    loadSavedControllers().find(
      (controller) => normalizeControllerUrl(controller.url) === normalized,
    )?.apiKey ??
    runtimeControllerKeys.get(normalized) ??
    ""
  );
}
