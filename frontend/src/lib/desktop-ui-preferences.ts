type DesktopUiPreferencesBridge = {
  loadUiPreferences?: () => Promise<Record<string, string>>;
  saveUiPreferences?: (prefs: Record<string, string>) => Promise<void>;
};

const DURABLE_EXACT_KEYS = new Set([
  "vllm-studio-state",
  "vllm-studio.customThemeTokens",
  "vllm-studio.controllers",
  "vllm-studio-setup-complete",
  "vllmstudio_backend_url",
]);

const DURABLE_KEY_PREFIXES = ["vllm-studio.", "vllm-studio-", "vllmstudio_", "vllm_studio_"];

let saveTimer: number | null = null;

function bridge(): DesktopUiPreferencesBridge | null {
  if (typeof window === "undefined") return null;
  return (
    (
      window as {
        vllmStudioDesktop?: DesktopUiPreferencesBridge;
      }
    ).vllmStudioDesktop ?? null
  );
}

function isDurableUiPreferenceKey(key: string): boolean {
  return (
    DURABLE_EXACT_KEYS.has(key) || DURABLE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function collectDurableUiPreferences(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !isDurableUiPreferenceKey(key)) continue;
    const value = window.localStorage.getItem(key);
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

async function loadControllerUiPreferences(): Promise<Record<string, string>> {
  try {
    const { default: api } = await import("@/lib/api");
    const settings = await api.getStudioSettings();
    return settings.persisted.ui_preferences ?? {};
  } catch {
    return {};
  }
}

async function saveControllerUiPreferences(prefs: Record<string, string>): Promise<void> {
  try {
    const { default: api } = await import("@/lib/api");
    await api.updateStudioSettings({ ui_preferences: prefs });
  } catch {
    // The controller can be unavailable during first boot/offline desktop use.
    // The desktop bridge remains a local fallback and the next UI change retries.
  }
}

function applyMissingPreferences(prefs: Record<string, string>): void {
  if (typeof window === "undefined") return;
  for (const [key, value] of Object.entries(prefs ?? {})) {
    if (!isDurableUiPreferenceKey(key) || typeof value !== "string") continue;
    // Renderer storage wins when present; controller/database is the durable
    // rebuild/reinstall fallback, not a stale override while the user is active.
    if (window.localStorage.getItem(key) === null) {
      window.localStorage.setItem(key, value);
    }
  }
}

export async function hydrateDurableUiPreferences(): Promise<void> {
  if (typeof window === "undefined") return;
  const desktop = bridge();
  const controllerPrefs = await loadControllerUiPreferences();
  applyMissingPreferences(controllerPrefs);
  if (!desktop?.loadUiPreferences) return;
  try {
    const prefs = await desktop.loadUiPreferences();
    applyMissingPreferences(prefs);
  } catch {
    // Keep localStorage-only behavior if the desktop bridge is unavailable.
  }
}

export function scheduleDurableUiPreferencesSave(): void {
  if (typeof window === "undefined") return;
  const desktop = bridge();
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    const prefs = collectDurableUiPreferences();
    void saveControllerUiPreferences(prefs);
    void desktop?.saveUiPreferences?.(prefs).catch(() => undefined);
  }, 200);
}
