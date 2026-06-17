"use client";

import { recordActivitySample } from "./dashboard-activity-store";

// Module-level guard for the last recorded utilization. This avoids touching
// React refs during render (which the react-hooks/refs rule forbids) while
// still deduping consecutive identical samples.
let lastRecordedUtil: number | null = null;

/**
 * Records a daily utilization sample. Called during the dashboard data hook's
 * render with the current avg GPU utilization; dedupes consecutive identical
 * values via a module-level guard (no refs, no useEffect).
 */
export function recordDashboardActivity(utilizationPct: number) {
  if (lastRecordedUtil === utilizationPct) return;
  lastRecordedUtil = utilizationPct;
  recordActivitySample(utilizationPct);
}
