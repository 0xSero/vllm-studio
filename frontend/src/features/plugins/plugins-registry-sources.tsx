"use client";

import { EmptySafeNotice } from "@/ui/list";
import {
  SettingsButton,
  SettingsFactRows,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  type SettingsFactRow,
} from "@/ui/settings";
import { StatusPill } from "@/ui/status";
import type { RegistrySource } from "./plugins-types";

export function RegistrySourcesPanel({
  sources,
  open,
  name,
  url,
  busyId,
  onToggleOpen,
  onNameChange,
  onUrlChange,
  onCancel,
  onSubmit,
  onToggleSource,
  onRemoveSource,
  loading = false,
}: {
  sources: RegistrySource[];
  open: boolean;
  name: string;
  url: string;
  busyId: string | null;
  onToggleOpen: () => void;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onToggleSource: (source: RegistrySource) => void;
  onRemoveSource: (source: RegistrySource) => void;
  loading?: boolean;
}) {
  const rows: SettingsFactRow[] = sources.map((source) => ({
    key: source.id,
    variant: "resource",
    label: source.name,
    description: source.url,
    value: source.builtIn ? "official" : "custom",
    status: {
      label: source.enabled ? "enabled" : "disabled",
      tone: source.enabled ? "good" : "default",
    },
    actions: source.builtIn ? undefined : (
      <>
        <SettingsButton
          onClick={() => onToggleSource(source)}
          disabled={busyId === `${source.id}:enabled`}
        >
          {source.enabled ? "Disable" : "Enable"}
        </SettingsButton>
        <SettingsButton
          tone="danger"
          onClick={() => onRemoveSource(source)}
          disabled={busyId === `${source.id}:remove`}
        >
          Remove
        </SettingsButton>
      </>
    ),
  }));

  return (
    <SettingsGroup
      title="Registry sources"
      description="The official MCP Registry is always available. Add compatible registries only when you trust their operators."
      actions={<SettingsButton onClick={onToggleOpen}>{open ? "Close" : "Add"}</SettingsButton>}
    >
      {sources.length ? (
        <SettingsFactRows rows={rows} />
      ) : (
        <EmptySafeNotice>
          {loading
            ? "Loading registry sources..."
            : "Official registry source did not load. Refresh to retry."}
        </EmptySafeNotice>
      )}
      {open ? (
        <>
          <SettingsRow
            label="Name"
            control={
              <SettingsInput
                value={name}
                onChange={onNameChange}
                placeholder="Company MCP Registry"
              />
            }
          />
          <SettingsRow
            label="URL"
            description="Must implement the official Registry API. HTTPS required except localhost."
            control={
              <SettingsInput
                value={url}
                onChange={onUrlChange}
                placeholder="https://registry.example.com"
              />
            }
          />
          <div className="flex justify-end gap-1 px-3.5 py-2">
            <SettingsButton onClick={onCancel}>Cancel</SettingsButton>
            <SettingsButton
              tone="primary"
              onClick={onSubmit}
              disabled={!url.trim() || busyId === "registry:add"}
            >
              Add registry
            </SettingsButton>
          </div>
        </>
      ) : null}
    </SettingsGroup>
  );
}
