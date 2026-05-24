// CRITICAL
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  Check,
  CircleDot,
  Eye,
  EyeOff,
  Link as LinkIcon,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type { ApiConnectionSettings, ConnectionStatus } from "../hooks/use-configs";
import {
  loadSavedControllers,
  normalizeControllerUrl,
  saveSavedControllers,
  type SavedController,
} from "@/lib/controllers";
import { getStoredBackendUrl, setStoredBackendUrl } from "@/lib/backend-url";
import { setApiKey } from "@/lib/api-key";
import { scheduleDurableUiPreferencesSave } from "@/lib/desktop-ui-preferences";
import {
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
  StatusPill,
  type StatusTone,
} from "@/components/settings-primitives";

type ControllerEntry = SavedController & { id: string };

/**
 * Rebuild the unified list: every controller stored in `vllm-studio.controllers`
 * is a first-class entry, the currently active controller (from
 * `vllmstudio_backend_url`) is just whichever row matches. If the active URL
 * isn't yet saved, we synthesize an entry for it so toggling away doesn't
 * lose it.
 */
function subscribeToStorage(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

let cachedEntriesKey = "";
let cachedEntries: ControllerEntry[] = [];

function controllerEntriesKey(entries: ControllerEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => [entry.id, entry.url, entry.name ?? "", entry.apiKey ?? ""]),
  );
}

function readEntries(): ControllerEntry[] {
  const saved = loadSavedControllers();
  const byUrl = new Map<string, SavedController>();
  for (const entry of saved) {
    const url = normalizeControllerUrl(entry.url);
    if (!url) continue;
    byUrl.set(url, { ...entry, url });
  }
  const next = [...byUrl.entries()].map(([url, value]) => ({
    id: url,
    url,
    apiKey: value.apiKey,
    name: value.name,
  }));
  const key = controllerEntriesKey(next);
  if (key === cachedEntriesKey) return cachedEntries;
  cachedEntriesKey = key;
  cachedEntries = next;
  return cachedEntries;
}

export function ApiConnectionSection({
  apiSettingsLoading,
  apiSettings,
  showApiKey,
  testing,
  saving,
  connectionStatus,
  statusMessage,
  onApiSettingsChange,
  onToggleApiKey,
  onTestConnection,
  onSave,
}: {
  apiSettingsLoading: boolean;
  apiSettings: ApiConnectionSettings;
  showApiKey: boolean;
  testing: boolean;
  saving: boolean;
  connectionStatus: ConnectionStatus;
  statusMessage: string;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onToggleApiKey: () => void;
  onTestConnection: () => void;
  onSave: () => void;
}) {
  const activeUrl = apiSettings.backendUrl;
  const entries = useSyncExternalStore(subscribeToStorage, readEntries, readEntries);
  const setEntries = (next: ControllerEntry[]) => {
    saveSavedControllers(next);
    scheduleDurableUiPreferencesSave();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("storage"));
  };
  const [draft, setDraft] = useState<SavedController>({ url: "" });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const activeId = useMemo(() => normalizeControllerUrl(activeUrl), [activeUrl]);
  const persist = setEntries;
  const toggleReveal = (id: string) =>
    setRevealed((current) => ({ ...current, [id]: !current[id] }));

  const activate = (entry: ControllerEntry) => {
    // Switching never deletes anything — every row stays in the list.
    if (entry.apiKey) setApiKey(entry.apiKey);
    setStoredBackendUrl(entry.url);
    onApiSettingsChange({
      ...apiSettings,
      backendUrl: entry.url,
      apiKey: entry.apiKey ?? "",
      hasApiKey: Boolean(entry.apiKey),
    });
    void fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backendUrl: entry.url,
        apiKey: entry.apiKey ?? "",
      }),
    }).finally(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("storage"));
      }
    });
  };

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Controllers"
        description="Every controller is saved in one list. Switch active with the radio button — nothing else changes."
        actions={
          <ApiStatus
            status={connectionStatus}
            message={statusMessage}
            loading={apiSettingsLoading}
          />
        }
      >
        <div className="flex flex-col divide-y divide-(--border)/40">
          {entries.length === 0 ? (
            <div className="px-1 py-3 text-[12px] text-(--dim)">
              No controllers yet. Add one below.
            </div>
          ) : (
            entries.map((entry, index) => (
              <ControllerListRow
                key={entry.id}
                entry={entry}
                index={index}
                active={entry.id === activeId}
                revealed={Boolean(revealed[entry.id])}
                onToggleReveal={() => toggleReveal(entry.id)}
                onActivate={() => activate(entry)}
                onCommit={(next) => {
                  // Persist + (if active) refresh the active settings only
                  // when the user finishes editing the field, not on every
                  // keystroke. This avoids re-rendering / re-keying the
                  // input and POSTing /api/settings per character.
                  const updated = entries.slice();
                  updated[index] = { ...next, id: entry.id };
                  persist(updated);
                  const urlChanged = normalizeControllerUrl(next.url) !== entry.id;
                  if (entry.id === activeId && urlChanged) {
                    const url = normalizeControllerUrl(next.url);
                    activate({ ...next, url, id: url });
                  } else if (entry.id === activeId && next.apiKey !== entry.apiKey) {
                    activate({ ...next, id: entry.id });
                  }
                }}
                onRemove={() => {
                  const remaining = entries.filter((row) => row.id !== entry.id);
                  persist(remaining);
                  if (entry.id === activeId && remaining[0]) activate(remaining[0]);
                }}
              />
            ))
          )}
          <div className="grid min-w-0 grid-cols-1 gap-2 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,0.9fr)_auto]">
            <SettingsInput
              value={draft.name ?? ""}
              placeholder="Name (e.g. homelab)"
              onChange={(name) => setDraft((current) => ({ ...current, name }))}
            />
            <SettingsInput
              value={draft.url}
              placeholder="http://192.168.1.70:8080"
              onChange={(url) => setDraft((current) => ({ ...current, url }))}
            />
            <div className="relative">
              <SettingsInput
                type={revealed.__draft ? "text" : "password"}
                value={draft.apiKey ?? ""}
                placeholder="API key optional"
                onChange={(apiKey) => setDraft((current) => ({ ...current, apiKey }))}
                className="pr-7"
              />
              <button
                type="button"
                onClick={() => toggleReveal("__draft")}
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                aria-label={revealed.__draft ? "Hide API key" : "Reveal API key"}
              >
                {revealed.__draft ? (
                  <EyeOff className="pointer-events-none h-3.5 w-3.5" />
                ) : (
                  <Eye className="pointer-events-none h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <SettingsButton
              onClick={() => {
                const url = normalizeControllerUrl(draft.url);
                if (!url) return;
                const exists = entries.find((entry) => entry.id === url);
                if (exists) return;
                persist([
                  ...entries,
                  {
                    id: url,
                    url,
                    apiKey: draft.apiKey?.trim() || undefined,
                    name: draft.name?.trim() || undefined,
                  },
                ]);
                setDraft({ url: "" });
              }}
              title="Add controller"
            >
              <Plus className="h-3 w-3" />
              Add
            </SettingsButton>
          </div>
        </div>

        <SettingsRow
          label="Active connection check"
          description="Fast status probe against the controller marked active above."
          value={<SettingsValue dim>{statusMessage || "Ready to test"}</SettingsValue>}
          actions={
            <>
              <SettingsButton onClick={onTestConnection} disabled={testing || apiSettingsLoading}>
                {testing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <LinkIcon className="h-3 w-3" />
                )}
                Test
              </SettingsButton>
              <SettingsButton
                onClick={onSave}
                disabled={saving || apiSettingsLoading}
                tone="primary"
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                Save active
              </SettingsButton>
            </>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Voice"
        description="Optional transcription endpoint used by voice workflows."
      >
        <SettingsRow
          label="Voice URL"
          description="Leave unset to keep voice disabled without breaking settings."
          control={
            <SettingsInput
              value={apiSettings.voiceUrl}
              placeholder="https://voice.example.com"
              onChange={(voiceUrl) => onApiSettingsChange({ ...apiSettings, voiceUrl })}
            />
          }
          status={
            <StatusPill tone={apiSettings.voiceUrl ? "info" : "default"}>
              {apiSettings.voiceUrl ? "custom" : "off"}
            </StatusPill>
          }
        />
        <SettingsRow
          label="Voice model"
          description="Stable default stays populated even when no voice backend is configured."
          control={
            <SettingsInput
              value={apiSettings.voiceModel}
              placeholder="whisper-large-v3-turbo"
              onChange={(voiceModel) => onApiSettingsChange({ ...apiSettings, voiceModel })}
            />
          }
          status={<StatusPill>{apiSettings.voiceModel ? "ready" : "default"}</StatusPill>}
        />
      </SettingsGroup>
    </div>
  );
}

function ControllerListRow({
  entry,
  index,
  active,
  revealed,
  onToggleReveal,
  onActivate,
  onCommit,
  onRemove,
}: {
  entry: ControllerEntry;
  index: number;
  active: boolean;
  revealed: boolean;
  onToggleReveal: () => void;
  onActivate: () => void;
  onCommit: (entry: ControllerEntry) => void;
  onRemove: () => void;
}) {
  // Local editing buffer. Parent keys this row by `entry.id`, so an
  // identity-changing edit (URL change) remounts and reseeds. Other
  // commits flow through `commit` below.
  const [draft, setDraft] = useState<ControllerEntry>(entry);
  const commit = (next: ControllerEntry) => {
    if (next.name === entry.name && next.url === entry.url && next.apiKey === entry.apiKey) {
      return;
    }
    onCommit(next);
  };
  return (
    <div
      className={`grid min-w-0 grid-cols-1 items-center gap-2 py-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,0.9fr)_auto] ${
        active ? "bg-(--accent)/5" : ""
      }`}
    >
      <button
        type="button"
        onClick={onActivate}
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${
          active
            ? "border-(--accent) text-(--accent)"
            : "border-(--border) text-(--dim) hover:text-(--fg)"
        }`}
        title={active ? "Active controller" : "Activate this controller"}
        aria-pressed={active}
      >
        {active ? (
          <CircleDot className="h-3.5 w-3.5" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-current" />
        )}
      </button>
      <SettingsInput
        value={draft.name ?? ""}
        placeholder={`Controller ${index + 1}`}
        onChange={(name) => setDraft((current) => ({ ...current, name }))}
        onBlur={() => commit(draft)}
      />
      <SettingsInput
        value={draft.url}
        placeholder="http://host:port"
        onChange={(url) => setDraft((current) => ({ ...current, url }))}
        onBlur={() => commit(draft)}
      />
      <div className="relative">
        <SettingsInput
          type={revealed ? "text" : "password"}
          value={draft.apiKey ?? ""}
          placeholder="API key optional"
          onChange={(apiKey) => setDraft((current) => ({ ...current, apiKey }))}
          onBlur={() => commit(draft)}
          className="pr-7"
        />
        <button
          type="button"
          onClick={onToggleReveal}
          className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          aria-label={revealed ? "Hide API key" : "Reveal API key"}
        >
          {revealed ? (
            <EyeOff className="pointer-events-none h-3.5 w-3.5" />
          ) : (
            <Eye className="pointer-events-none h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <SettingsButton tone="danger" onClick={onRemove} title="Remove controller">
        <Trash2 className="h-3 w-3" />
      </SettingsButton>
    </div>
  );
}

function ApiStatus({
  status,
  message,
  loading,
}: {
  status: ConnectionStatus;
  message: string;
  loading: boolean;
}) {
  if (loading) {
    return <StatusPill tone="info">loading</StatusPill>;
  }
  const tone: StatusTone =
    status === "connected" ? "good" : status === "error" ? "danger" : "default";
  const label = message || (status === "unknown" ? "not tested" : status);
  return (
    <span className="inline-flex items-center gap-1.5">
      {status === "connected" ? <Check className="h-3 w-3 text-(--hl2)" /> : null}
      {status === "error" ? <X className="h-3 w-3 text-(--err)" /> : null}
      <StatusPill tone={tone}>{label}</StatusPill>
    </span>
  );
}
