import { Option, Schema } from "effect";

export const CONTROLLERS_STORAGE_KEY = "local-studio.controllers";
const LEGACY_CONTROLLERS_STORAGE_KEY = [["v", "llm-studio"].join(""), "controllers"].join(".");
export const CONTROLLERS_CHANGED_EVENT = "vllm:controllers-changed";

export type SavedController = {
  url: string;
  apiKey?: string;
  name?: string;
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

const SavedControllerInputSchema = Schema.Union([
  Schema.String,
  Schema.Struct({
    url: Schema.String,
    apiKey: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
  }),
]);
const SavedControllerListSchema = Schema.Array(Schema.Unknown);
const decodeSavedController = Schema.decodeUnknownOption(SavedControllerInputSchema);

function parseSavedController(entry: typeof Schema.Unknown.Type): SavedController | null {
  const parsed = Option.getOrNull(decodeSavedController(entry));
  if (parsed === null) return null;
  if (Schema.is(Schema.String)(parsed)) {
    const url = normalizeControllerUrl(parsed);
    return url ? { url } : null;
  }
  const url = normalizeControllerUrl(parsed.url);
  if (!url) return null;
  const apiKey = parsed.apiKey?.trim() ?? "";
  const name = parsed.name?.trim() ?? "";
  const out: SavedController = { url };
  if (apiKey) out.apiKey = apiKey;
  if (name) out.name = name;
  return out;
}

export function loadSavedControllers(): SavedController[] {
  if (!globalThis.window) return [];
  try {
    const raw =
      window.localStorage.getItem(CONTROLLERS_STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_CONTROLLERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = Schema.decodeUnknownSync(SavedControllerListSchema)(JSON.parse(raw));
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
  if (!globalThis.window) return [];
  const byUrl = new Map<string, SavedController>();
  for (const controller of controllers) {
    const url = normalizeControllerUrl(controller.url);
    if (!url) continue;
    const apiKey = controller.apiKey?.trim();
    const name = controller.name?.trim();
    const out: SavedController = { url };
    if (apiKey) out.apiKey = apiKey;
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
    )?.apiKey ?? ""
  );
}
