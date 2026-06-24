"use client";

import { Search } from "@/ui/icon-registry";
import { EmptySafeNotice } from "@/ui/list";
import { SettingsGroup, SettingsInput, SettingsRow } from "@/ui/settings";
import { StatusPill } from "@/ui/status";
import { RegistryRow } from "./plugins-page-parts";
import type { CatalogueEntry } from "./plugins-types";

export function RegistrySearchPanel({
  title = "Browse and connect MCP servers",
  description = "Search OAuth-capable and stdio MCP servers. Managed OAuth entries connect without env or key fields.",
  entries,
  loading,
  search,
  installedNames,
  busyId,
  onSearchChange,
  onConfigure,
}: {
  title?: string;
  description?: string;
  entries: CatalogueEntry[];
  loading: boolean;
  search: string;
  installedNames: Set<string>;
  busyId: string | null;
  onSearchChange: (value: string) => void;
  onConfigure: (entry: CatalogueEntry) => void;
}) {
  return (
    <SettingsGroup
      title={title}
      description={description}
      actions={
        <StatusPill tone={loading ? "info" : "good"} variant="badge">
          {loading ? "searching" : `${entries.length} results`}
        </StatusPill>
      }
    >
      <SettingsRow
        label="Search plugins"
        description="OAuth-managed results show a Connect action. Other results may need a local command or token."
        control={
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ui-muted)" />
            <SettingsInput
              value={search}
              onChange={onSearchChange}
              placeholder="GitHub, Postgres, filesystem..."
              className="pl-8"
            />
          </div>
        }
      />
      {entries.map((entry) => (
        <RegistryRow
          key={entry.id}
          entry={entry}
          added={installedNames.has(entry.name.toLowerCase())}
          busy={busyId === entry.id}
          onConfigure={() => onConfigure(entry)}
        />
      ))}
      {!entries.length && !loading ? (
        <EmptySafeNotice>No registry matches. Try a broader search.</EmptySafeNotice>
      ) : null}
    </SettingsGroup>
  );
}
