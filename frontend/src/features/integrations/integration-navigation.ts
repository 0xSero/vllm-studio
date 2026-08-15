export const INTEGRATION_SECTION_IDS = ["plugins", "connectors", "models", "skills"] as const;

export type IntegrationSectionId = (typeof INTEGRATION_SECTION_IDS)[number];

export function integrationSectionFromHash(hash: string): IntegrationSectionId {
  const section = hash.replace(/^#/, "");
  return INTEGRATION_SECTION_IDS.find((candidate) => candidate === section) ?? "plugins";
}

export function integrationSettingsHref(section?: string | null): string {
  return `/settings?integration=${integrationSectionFromHash(section ?? "")}#integrations`;
}

export function integrationSectionFromLocation(search: string, hash: string): IntegrationSectionId {
  const querySection = new URLSearchParams(search).get("integration");
  return integrationSectionFromHash(querySection || hash);
}

export function legacyIntegrationHref(hash: string): string | null {
  const section = hash.replace(/^#/, "");
  if (section !== "connectors" && section !== "skills") return null;
  return integrationSettingsHref(section);
}
