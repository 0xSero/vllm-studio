// Characterization tests for the status-sync consolidation. These pin the
// sidebar status derivation (previously a standalone store in
// use-sidebar-status.ts with its own SSE listener and 10s poll) as a pure
// selector over the realtime status snapshot.
import assert from "node:assert/strict";
import test from "node:test";

import {
  isActiveLaunchStage,
  sidebarStatusFromSnapshot,
} from "@/hooks/realtime-status-store";
import type { StatusData } from "@/hooks/realtime-status-store";
import type { LaunchProgressData, ProcessInfo } from "@/lib/types";

function makeProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    pid: 4242,
    backend: "vllm",
    port: 8000,
    served_model_name: "deepseek-v4-flash",
    model_path: "/models/deepseek-v4-flash",
    ...overrides,
  } as ProcessInfo;
}

function makeStatus(overrides: Partial<StatusData> = {}): StatusData {
  return {
    running: true,
    process: makeProcess(),
    inference_port: 8000,
    launching: null,
    ...overrides,
  };
}

function makeLaunch(overrides: Partial<LaunchProgressData> = {}): LaunchProgressData {
  return {
    recipe_id: "recipe-1",
    stage: "launching",
    message: "Loading weights",
    ...overrides,
  };
}

test("sidebar: disconnected controller reads Offline", () => {
  const snap = sidebarStatusFromSnapshot({ connected: false, status: null, launchProgress: null });
  assert.deepEqual(snap, {
    online: false,
    inferenceOnline: false,
    model: null,
    activityLine: "Offline",
  });
});

test("sidebar: connected with no model reads No model", () => {
  const snap = sidebarStatusFromSnapshot({
    connected: true,
    status: makeStatus({ running: false, process: null }),
    launchProgress: null,
  });
  assert.deepEqual(snap, {
    online: true,
    inferenceOnline: false,
    model: null,
    activityLine: "No model",
  });
});

test("sidebar: running model shows the served model name", () => {
  const snap = sidebarStatusFromSnapshot({
    connected: true,
    status: makeStatus(),
    launchProgress: null,
  });
  assert.equal(snap.online, true);
  assert.equal(snap.inferenceOnline, true);
  assert.equal(snap.model, "deepseek-v4-flash");
  assert.equal(snap.activityLine, "deepseek-v4-flash");
});

test("sidebar: model name falls back to the model path basename", () => {
  const snap = sidebarStatusFromSnapshot({
    connected: true,
    status: makeStatus({
      process: makeProcess({ served_model_name: "  ", model_path: "/models/llama-3-70b" }),
    }),
    launchProgress: null,
  });
  assert.equal(snap.model, "llama-3-70b");
});

test("sidebar: running without process info reads Ready", () => {
  const snap = sidebarStatusFromSnapshot({
    connected: true,
    status: makeStatus({ running: true, process: null }),
    launchProgress: null,
  });
  assert.equal(snap.inferenceOnline, true);
  assert.equal(snap.model, null);
  assert.equal(snap.activityLine, "Ready");
});

test("sidebar: a process implies inference online even when running is false", () => {
  const snap = sidebarStatusFromSnapshot({
    connected: true,
    status: makeStatus({ running: false }),
    launchProgress: null,
  });
  assert.equal(snap.inferenceOnline, true);
});

test("sidebar: active launch message outranks the model line", () => {
  const snap = sidebarStatusFromSnapshot({
    connected: true,
    status: makeStatus(),
    launchProgress: makeLaunch(),
  });
  assert.equal(snap.activityLine, "Loading weights");
});

test("sidebar: terminal launch stages do not hold the activity line", () => {
  for (const stage of ["ready", "error", "cancelled"] as const) {
    const snap = sidebarStatusFromSnapshot({
      connected: true,
      status: makeStatus(),
      launchProgress: makeLaunch({ stage }),
    });
    assert.equal(snap.activityLine, "deepseek-v4-flash", `stage=${stage}`);
  }
});

test("sidebar: empty launch message falls through to the model line", () => {
  const snap = sidebarStatusFromSnapshot({
    connected: true,
    status: makeStatus(),
    launchProgress: makeLaunch({ message: "" }),
  });
  assert.equal(snap.activityLine, "deepseek-v4-flash");
});

test("launch stages: preempting/evicting/launching/waiting are active, terminals are not", () => {
  for (const stage of ["preempting", "evicting", "launching", "waiting"] as const) {
    assert.equal(isActiveLaunchStage(stage), true, stage);
  }
  for (const stage of ["ready", "error", "cancelled", null, undefined] as const) {
    assert.equal(isActiveLaunchStage(stage), false, String(stage));
  }
});
