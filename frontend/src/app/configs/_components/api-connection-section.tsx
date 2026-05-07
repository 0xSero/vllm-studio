// CRITICAL
import { Check, Eye, EyeOff, Link, Loader2, Save, X } from "lucide-react";
import type { ApiConnectionSettings, ConnectionStatus } from "../hooks/use-configs";
import {
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
  StatusPill,
  type StatusTone,
} from "./settings-primitives";

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
  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Controller"
        description="Where the desktop app reads runtime state, launches engines, and proxies model APIs."
        actions={
          <ApiStatus
            status={connectionStatus}
            message={statusMessage}
            loading={apiSettingsLoading}
          />
        }
      >
        <SettingsRow
          label="Controller URL"
          description="Saved locally first so the app can recover without the backend."
          control={
            <SettingsInput
              value={apiSettings.backendUrl}
              placeholder="http://127.0.0.1:8080"
              onChange={(backendUrl) => onApiSettingsChange({ ...apiSettings, backendUrl })}
            />
          }
          status={
            <StatusPill tone={apiSettings.backendUrl ? "info" : "warning"}>required</StatusPill>
          }
        />
        <SettingsRow
          label="API key"
          description="Stored masked; never displayed unless you choose reveal."
          control={
            <div className="relative">
              <SettingsInput
                type={showApiKey ? "text" : "password"}
                value={apiSettings.apiKey}
                placeholder={apiSettings.hasApiKey ? "••••••••" : "Optional"}
                onChange={(apiKey) => onApiSettingsChange({ ...apiSettings, apiKey })}
              />
              <button
                type="button"
                onClick={onToggleApiKey}
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                aria-label={showApiKey ? "Hide API key" : "Reveal API key"}
              >
                {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          }
          status={
            <StatusPill tone={apiSettings.hasApiKey || apiSettings.apiKey ? "good" : "default"}>
              {apiSettings.hasApiKey || apiSettings.apiKey ? "stored" : "unset"}
            </StatusPill>
          }
        />
        <SettingsRow
          label="Connection check"
          description="Fast status probe; config and compatibility hydrate separately."
          value={<SettingsValue dim>{statusMessage || "Ready to test"}</SettingsValue>}
          actions={
            <>
              <SettingsButton onClick={onTestConnection} disabled={testing || apiSettingsLoading}>
                {testing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Link className="h-3 w-3" />
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
                Save
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
