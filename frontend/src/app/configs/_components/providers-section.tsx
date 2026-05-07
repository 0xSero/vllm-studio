"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Plus, Power, PowerOff, Trash2, X } from "lucide-react";
import api from "@/lib/api";
import {
  EmptySafeNotice,
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
  StatusPill,
} from "@/components/settings-primitives";

interface ProviderEntry {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  has_api_key: boolean;
}

type Draft = { id: string; name: string; base_url: string; api_key: string; show: boolean };
type Editor = { id: string; key: string; show: boolean };

const DEFAULT_DRAFT: Draft = { id: "", name: "", base_url: "", api_key: "", show: false };
const WELL_KNOWN: Record<string, { name: string; base_url: string; note: string }> = {
  openai: {
    name: "OpenAI",
    base_url: "https://api.openai.com",
    note: "Official OpenAI-compatible hosted models.",
  },
  anthropic: {
    name: "Anthropic",
    base_url: "https://api.anthropic.com",
    note: "Claude models through the Anthropic API.",
  },
};

export function ProvidersSection() {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setProviders((await api.getProviders()).providers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const mutate = async (work: () => Promise<unknown>) => {
    try {
      setBusy(true);
      setError(null);
      await work();
      await loadProviders();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () =>
    draft &&
    mutate(async () => {
      await api.createProvider({
        id: draft.id.trim().toLowerCase(),
        name: draft.name.trim(),
        base_url: draft.base_url.trim(),
        api_key: draft.api_key.trim(),
      });
      setDraft(null);
    });

  const providerRows = providers.length ? (
    providers.map((provider) => (
      <SettingsRow
        key={provider.id}
        label={provider.name}
        description={provider.base_url}
        value={
          <SettingsValue>
            {provider.enabled ? "Enabled" : "Disabled"} ·{" "}
            {provider.has_api_key ? "key stored" : "key missing"}
          </SettingsValue>
        }
        status={
          <StatusPill
            tone={provider.enabled ? (provider.has_api_key ? "good" : "warning") : "default"}
          >
            {provider.enabled ? (provider.has_api_key ? "active" : "needs key") : "off"}
          </StatusPill>
        }
        actions={
          <>
            <SettingsButton onClick={() => setEditor({ id: provider.id, key: "", show: false })}>
              Key
            </SettingsButton>
            <SettingsButton
              onClick={() =>
                void mutate(() => api.updateProvider(provider.id, { enabled: !provider.enabled }))
              }
            >
              {provider.enabled ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
            </SettingsButton>
            <SettingsButton
              tone="danger"
              onClick={() => void mutate(() => api.deleteProvider(provider.id))}
            >
              <Trash2 className="h-3 w-3" />
            </SettingsButton>
          </>
        }
      >
        {editor?.id === provider.id ? (
          <div className="flex min-w-0 items-center gap-2">
            <KeyInput
              value={editor.key}
              show={editor.show}
              placeholder={provider.has_api_key ? "••••••••" : "Enter API key"}
              onChange={(key) => setEditor({ ...editor, key })}
              onToggle={() => setEditor({ ...editor, show: !editor.show })}
            />
            <SettingsButton
              tone="primary"
              disabled={busy || !editor.key.trim()}
              onClick={() =>
                void mutate(() =>
                  api.updateProvider(provider.id, { api_key: editor.key.trim() }),
                ).then(() => setEditor(null))
              }
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            </SettingsButton>
            <SettingsButton onClick={() => setEditor(null)}>
              <X className="h-3 w-3" />
            </SettingsButton>
          </div>
        ) : null}
      </SettingsRow>
    ))
  ) : (
    <SettingsRow
      label="Provider registry"
      description="No installed external provider yet; use the ready rows below."
      value={<SettingsValue dim>Local inference still works through the controller.</SettingsValue>}
      status={<StatusPill>ready</StatusPill>}
    />
  );

  const available = Object.entries(WELL_KNOWN).filter(
    ([id]) => !providers.some((provider) => provider.id === id),
  );

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Providers"
        description="External routes are plugin-like: installed, enabled, keyed, and safe to disable."
        actions={
          <StatusPill
            tone={loading ? "info" : error ? "danger" : providers.length ? "good" : "default"}
          >
            {loading ? "loading" : error ? "needs attention" : `${providers.length} configured`}
          </StatusPill>
        }
      >
        {loading ? (
          <SettingsRow
            label="Provider registry"
            description="Fetching provider rows from the controller."
            value={<SettingsValue dim>Loading providers…</SettingsValue>}
            status={<StatusPill tone="info">syncing</StatusPill>}
          />
        ) : error ? (
          <SettingsRow
            label="Controller response"
            description="Provider rows remain populated while the backend recovers."
            value={<SettingsValue dim>{error}</SettingsValue>}
            status={<StatusPill tone="danger">error</StatusPill>}
          />
        ) : (
          providerRows
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Add provider"
        description="Common providers stay visible before they are installed."
      >
        {draft ? (
          <DraftRows
            draft={draft}
            busy={busy}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={saveDraft}
          />
        ) : (
          <>
            {available.map(([id, known]) => (
              <SettingsRow
                key={id}
                label={known.name}
                description={known.note}
                value={<SettingsValue mono>{known.base_url}</SettingsValue>}
                status={<StatusPill tone="info">available</StatusPill>}
                actions={
                  <SettingsButton onClick={() => setDraft({ ...DEFAULT_DRAFT, id, ...known })}>
                    <Plus className="h-3 w-3" />
                    Add
                  </SettingsButton>
                }
              />
            ))}
            <SettingsRow
              label="Custom provider"
              description="Any OpenAI-compatible endpoint with a base URL and optional key."
              value={<SettingsValue dim>Base URL + name + model probe later.</SettingsValue>}
              status={<StatusPill>template</StatusPill>}
              actions={
                <SettingsButton onClick={() => setDraft(DEFAULT_DRAFT)}>
                  <Plus className="h-3 w-3" />
                  Add
                </SettingsButton>
              }
            />
          </>
        )}
      </SettingsGroup>
    </div>
  );
}

function DraftRows({
  draft,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const required = Boolean(draft.id.trim() && draft.name.trim() && draft.base_url.trim());
  const fields = [
    [
      "Provider ID",
      "Lowercase route prefix, for example provider/model-name.",
      "id",
      "openai",
      true,
    ],
    [
      "Display name",
      "Human-readable name shown in model routing controls.",
      "name",
      "OpenAI",
      true,
    ],
    [
      "Base URL",
      "Provider API origin resolved by the controller.",
      "base_url",
      "https://api.openai.com",
      true,
    ],
  ] as const;

  return (
    <>
      {fields.map(([label, description, key, placeholder, requiredField]) => (
        <SettingsRow
          key={key}
          label={label}
          description={description}
          control={
            <SettingsInput
              value={draft[key]}
              placeholder={placeholder}
              onChange={(value) => onChange({ ...draft, [key]: value })}
            />
          }
          status={
            <StatusPill tone={draft[key].trim() ? "good" : requiredField ? "warning" : "default"}>
              {requiredField ? "required" : "optional"}
            </StatusPill>
          }
        />
      ))}
      <SettingsRow
        label="API key"
        description="Optional for local gateways; masked when saved."
        control={
          <KeyInput
            value={draft.api_key}
            show={draft.show}
            placeholder="sk-..."
            onChange={(api_key) => onChange({ ...draft, api_key })}
            onToggle={() => onChange({ ...draft, show: !draft.show })}
          />
        }
        status={<StatusPill>{draft.api_key.trim() ? "provided" : "optional"}</StatusPill>}
      />
      <SettingsRow
        label="Create"
        description="The provider appears immediately after the controller accepts it."
        value={
          <EmptySafeNotice>
            All required fields stay visible until the provider is created or cancelled.
          </EmptySafeNotice>
        }
        actions={
          <>
            <SettingsButton onClick={onCancel}>Cancel</SettingsButton>
            <SettingsButton onClick={onSave} disabled={busy || !required} tone="primary">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Add
            </SettingsButton>
          </>
        }
      />
    </>
  );
}

function KeyInput({
  value,
  show,
  placeholder,
  onChange,
  onToggle,
}: {
  value: string;
  show: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <SettingsInput
        type={show ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        aria-label={show ? "Hide API key" : "Reveal API key"}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
