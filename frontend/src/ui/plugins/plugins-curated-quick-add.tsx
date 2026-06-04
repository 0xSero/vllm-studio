"use client";

import { SettingsGroup } from "../settings";
import { RegistryRow } from "./plugins-page-parts";
import type { CatalogueEntry } from "./plugins-types";

export function CuratedQuickAddPanel({
  entries,
  installedNames,
  busyId,
  onConfigure,
}: {
  entries: CatalogueEntry[];
  installedNames: Set<string>;
  busyId: string | null;
  onConfigure: (entry: CatalogueEntry) => void;
}) {
  return (
    <SettingsGroup
      title="Curated quick add"
      description="Fixed stdio launch lines for high-confidence reference servers."
    >
      {entries.map((entry) => (
        <RegistryRow
          key={entry.id}
          entry={entry}
          added={installedNames.has(entry.name.toLowerCase())}
          busy={busyId === entry.id}
          onConfigure={() => onConfigure(entry)}
        />
      ))}
    </SettingsGroup>
  );
}
