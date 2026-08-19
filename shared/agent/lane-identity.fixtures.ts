export type { ExclusiveLane, ResidentLane } from "./lane-identity";
import type { ExclusiveLane, ResidentLane } from "./lane-identity";

export const EXCLUSIVE_LANE_OF_CASES: ReadonlyArray<{
  input: string;
  lane: ExclusiveLane | null;
}> = [
  { input: "omlx/laguna-s-2.1", lane: "omlx" },
  { input: "omlx/laguna-xs-2.1", lane: "omlx" },
  { input: "omlx/qwen3.8-27b", lane: "omlx" },
  { input: "  omlx/laguna-s-2.1  ", lane: "omlx" },
  { input: "OMLX/laguna-s-2.1", lane: "omlx" },
  { input: "user-pi-omlx/laguna-s-2.1", lane: "omlx" },
  { input: "user-pi-user-pi-omlx/laguna-s-2.1", lane: "omlx" },
  { input: "USER-PI-OMLX/laguna-s-2.1", lane: "omlx" },
  { input: "ds4/deepseek-v4-flash", lane: "ds4" },
  { input: "user-pi-ds4/deepseek-v4-flash", lane: "ds4" },
  { input: "user-pi-user-pi-ds4/deepseek-v4-flash", lane: "ds4" },
  { input: "amd/AMD-qwen3.8-27b", lane: null },
  { input: "user-pi-amd/AMD-qwen3.8-27b", lane: null },
  { input: "anthropic/claude", lane: null },
  { input: "laguna-s-2.1", lane: null },
  { input: "omlx", lane: null },
  { input: "omlx/", lane: null },
  { input: "", lane: null },
  { input: "   ", lane: null },
];

export const SHOULD_REQUEST_LANE_SWITCH_CASES: ReadonlyArray<{
  nextModelId: string;
  residentLane: ResidentLane | "unknown";
  expected: ExclusiveLane | null;
}> = [
  {
    nextModelId: "user-pi-ds4/deepseek-v4-flash",
    residentLane: "omlx",
    expected: "ds4",
  },
  {
    nextModelId: "user-pi-omlx/laguna-xs-2.1",
    residentLane: "omlx",
    expected: null,
  },
  {
    nextModelId: "user-pi-omlx/laguna-s-2.1",
    residentLane: "ds4",
    expected: "omlx",
  },
  {
    nextModelId: "user-pi-ds4/deepseek-v4-flash",
    residentLane: "none",
    expected: "ds4",
  },
  {
    nextModelId: "user-pi-ds4/deepseek-v4-flash",
    residentLane: "conflict",
    expected: "ds4",
  },
  {
    nextModelId: "amd/AMD-qwen3.8-27b",
    residentLane: "omlx",
    expected: null,
  },
  {
    nextModelId: "omlx/laguna-s-2.1",
    residentLane: "unknown",
    expected: null,
  },
  {
    nextModelId: "omlx/laguna-xs-2.1",
    residentLane: "unknown",
    expected: null,
  },
  {
    nextModelId: "ds4/deepseek-v4-flash",
    residentLane: "ds4",
    expected: null,
  },
  {
    nextModelId: "laguna-s-2.1",
    residentLane: "none",
    expected: null,
  },
];
