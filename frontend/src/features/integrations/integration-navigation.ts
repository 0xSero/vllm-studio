export const INTEGRATION_SECTION_IDS = [
  "connectors",
  "plugins",
  "accounts",
  "access",
  "models",
  "skills",
] as const;

export type IntegrationSectionId = (typeof INTEGRATION_SECTION_IDS)[number];

export const DEFAULT_INTEGRATION_SECTION: IntegrationSectionId = "connectors";

export function integrationSectionFromHash(hash: string): IntegrationSectionId {
  const section = hash.replace(/^#/, "").trim().toLowerCase();
  return (
    INTEGRATION_SECTION_IDS.find((candidate) => candidate === section) ??
    DEFAULT_INTEGRATION_SECTION
  );
}

/**
 * Where a pre-move `/settings#connectors` or `#skills` link should land.
 *
 * Both hashes named sections of Settings once, then sections of Configure, and
 * now sections of a page of their own. Each move left the old link pointing at
 * a surface that no longer holds the thing it named, so the redirect is what
 * keeps a bookmark honest — it just has one fewer hop to make than it did.
 */
export function legacyIntegrationHref(hash: string): string | null {
  const section = hash.replace(/^#/, "").trim().toLowerCase();
  if (section !== "connectors" && section !== "skills") return null;
  return `/integrations#${section}`;
}
