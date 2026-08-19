/**
 * The sections Configure can actually show.
 *
 * "models" used to be listed here and rendered by the page, but no nav entry
 * pointed at it — the only links that reached it were two dashboard buttons,
 * and they silently landed on Overview. Models has its own route; this list is
 * now exactly what the section nav offers.
 */
export const CONFIGURE_SECTION_IDS = [
  "overview",
  "rig",
  "integrations",
  "server",
] as const;

export type ConfigureSectionId = (typeof CONFIGURE_SECTION_IDS)[number];

export function configureSectionFromHash(hash: string): ConfigureSectionId {
  const section = hash.replace(/^#/, "");
  return CONFIGURE_SECTION_IDS.find((candidate) => candidate === section) ?? "overview";
}
