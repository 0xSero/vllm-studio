export const INTEGRATION_SECTION_IDS = ["accounts", "skills"] as const;

export type IntegrationSectionId = (typeof INTEGRATION_SECTION_IDS)[number];

export const DEFAULT_INTEGRATION_SECTION: IntegrationSectionId = "accounts";

export function integrationSectionFromHash(hash: string): IntegrationSectionId {
  const section = hash.replace(/^#/, "").trim().toLowerCase();
  if (section === "connectors") return "accounts";
  return (
    INTEGRATION_SECTION_IDS.find((candidate) => candidate === section) ??
    DEFAULT_INTEGRATION_SECTION
  );
}
