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
 * `integrations` was a tenant, not a resident: connectors and skills are not
 * hardware. It has its own route now, and the only trace left here is the
 * forwarding address at the bottom of this file.
 */
export const CONFIGURE_SECTION_IDS = ["machines", "server"] as const;

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

/**
 * The route a hash or `?section=` value that Configure no longer serves should
 * be sent to, or null when Configure can still answer for it.
 *
 * Without this, `/configure?section=integrations#integrations` — the address
 * the old `/integrations` redirect pointed at, and so the one in every link
 * and bookmark written while Integrations lived here — resolves to no known
 * section and silently lands on Machines, which looks like the connectors
 * page having lost its contents.
 */
export function configureSectionRedirect(hash: string): string | null {
  const section = hash.replace(/^#/, "").trim().toLowerCase();
  return section === "integrations" ? "/integrations#connectors" : null;
}
