import type { ExclusiveLane, ResidentLane } from "../../shared/agent/lane-identity";

export type LaneSwitchState = "idle" | "running" | "ready" | "failed" | "restoring";

export type LaneProbeView = {
  ready: boolean;
  port: number;
  model_ids: string[];
};

export type LaneSwitchJobView = {
  id: string | null;
  state: LaneSwitchState;
  from_lane: ResidentLane | null;
  to_lane: ExclusiveLane | null;
  script: string | null;
  exit_code: number | null;
  message: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  idempotent?: boolean;
};

export type LaneStatus = {
  enabled: boolean;
  configured: boolean;
  resident_lane: ResidentLane;
  omlx: LaneProbeView;
  ds4: LaneProbeView;
  switch: LaneSwitchJobView;
};
