// Canonical context-usage shape shared by controller events and the frontend's
// runtime schema.
export type RuntimeContextUsage = {
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly percent: number | null;
  readonly shouldCompact: boolean;
};
