"use client";

import { Search } from "lucide-react";
import { EmptySafeNotice } from "../list";
import { SettingsGroup, SettingsInput, SettingsRow } from "../settings";
import { StatusPill } from "../status";
import { RegistryRow } from "./plugins-page-parts";
import type { CatalogueEntry } from "./plugins-types";

export function RegistrySearchPanel({
  entries,
  loading,
  search,
  installedNames,
  busyId,
  onSearchChange,
  onConfigure,
}: {
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
      title="Official MCP Registry"
      description="Search the official MCP Registry plus any compatible registries you explicitly enable."
      actions={
        <StatusPill tone={loading ? "info" : "good"} variant="badge">
          {loading ? "searching" : `${entries.length} results`}
        </StatusPill>
      }
    >
      <SettingsRow
        label="Search registry"
        description="Search server names from enabled MCP registries."
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
