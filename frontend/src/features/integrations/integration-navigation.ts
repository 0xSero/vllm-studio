export const INTEGRATION_SECTION_IDS = ["connectors", "accounts", "skills"] as const;

export type IntegrationSectionId = (typeof INTEGRATION_SECTION_IDS)[number];

export const DEFAULT_INTEGRATION_SECTION: IntegrationSectionId = "connectors";

export function integrationSectionFromHash(hash: string): IntegrationSectionId {
  const section = hash.replace(/^#/, "").trim().toLowerCase();
  return (
    INTEGRATION_SECTION_IDS.find((candidate) => candidate === section) ??
    DEFAULT_INTEGRATION_SECTION
  );
}
