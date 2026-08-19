/**
 * The sections Configure can actually show.
 *
 * Configure is about this machine and the machines it talks to: the hardware
 * that runs models, and the controller that drives it. It used to open on an
 * "Overview" table whose four rows were the four items of this very list —
 * three of them filled with invented strings like "Get · serve" under a column
 * headed "Detail" — so the first thing the page did was ask you to choose a
 * section twice. Machines is the landing section now.
 *
 * `integrations` is a tenant, not a resident: connectors and skills are not
 * hardware, and they move to their own route. The entry stays until that route
 * exists so the `/integrations` redirect keeps landing on real content.
 */
export const CONFIGURE_SECTION_IDS = ["machines", "integrations", "server"] as const;

export type ConfigureSectionId = (typeof CONFIGURE_SECTION_IDS)[number];

export const DEFAULT_CONFIGURE_SECTION: ConfigureSectionId = "machines";

/** Hashes and `?section=` values that shipped before the rebuild. */
const SECTION_ALIASES: Record<string, ConfigureSectionId> = {
  overview: "machines",
  rig: "machines",
  rigs: "machines",
};

/**
 * The section a hash or `?section=` value names, or null when it names none.
 *
 * Null rather than a default, so the caller can tell "the URL asked for
 * Machines" apart from "the URL asked for nothing" — the old version collapsed
 * both onto `overview` and then had to guess which had happened.
 */
export function configureSectionFromHash(hash: string): ConfigureSectionId | null {
  const section = hash.replace(/^#/, "").trim().toLowerCase();
  if (!section) return null;
  return (
    CONFIGURE_SECTION_IDS.find((candidate) => candidate === section) ??
    SECTION_ALIASES[section] ??
    null
  );
}
