import type {
  RegistryHardwareMatch,
  RegistryIndex,
  RegistryRecommendationsPayload,
} from "@local-studio/contracts/registry";
import { fitStateFor } from "./hardware-match";

export type RegistryRecommendationRow = RegistryRecommendationsPayload["rows"][number];

/**
 * Join discovery rows with this machine's hardware matches. Matched configs
 * come first so the Recommended tab leads with what fits; with `includeAll`
 * the remaining registry rows stay visible and consumable.
 */
export const buildRecommendations = (
  index: RegistryIndex,
  matches: readonly RegistryHardwareMatch[],
  includeAll: boolean,
  baseUrl: string,
  fetchedAt: string,
): RegistryRecommendationsPayload => {
  const matchById = new Map(
    matches.filter((match) => match.matched).map((match) => [match.hardware_id, match]),
  );
  const annotated: RegistryRecommendationRow[] = index.recipes.map((row) => ({
    row,
    fit: {
      state: fitStateFor(row, matches),
      hardware_match: matchById.get(row.hardware_id) ?? null,
    },
  }));
  annotated.sort((a, b) => {
    if (a.fit.state !== b.fit.state) return a.fit.state === "match" ? -1 : 1;
    if (a.row.status !== b.row.status) return a.row.status === "validated" ? -1 : 1;
    if (a.row.has_evidence !== b.row.has_evidence) return a.row.has_evidence ? -1 : 1;
    if (a.row.hardware_id !== b.row.hardware_id) {
      return a.row.hardware_id.localeCompare(b.row.hardware_id);
    }
    return a.row.id.localeCompare(b.row.id);
  });
  const rows = includeAll ? annotated : annotated.filter((entry) => entry.fit.state === "match");
  const matched = annotated.filter((entry) => entry.fit.state === "match").length;
  return {
    base_url: baseUrl,
    fetched_at: fetchedAt,
    counts: { total: annotated.length, matched },
    matches,
    rows,
  };
};
