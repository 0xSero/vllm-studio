import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserFrameSource,
  browserSurfaceRequest,
  BrowserSessionSurface,
} from "@/features/agent/browser/session-surface";

test("a previous session frame is hidden before the new poll settles", () => {
  const frame = { sessionId: "session-a", src: "data:image/jpeg;base64,a" };
  assert.equal(browserFrameSource(frame, "session-a"), frame.src);
  assert.equal(browserFrameSource(frame, "session-b"), null);
  assert.equal(browserFrameSource(frame, null), null);
});

test("switching sessions aborts old traffic without replaying the inherited URL", () => {
  const surface = new BrowserSessionSurface();
  surface.enterSession("session-a", "https://a.example");
  const frameA = surface.requestController("session-a");
  const navigationA = surface.requestController("session-a");
  const inputA = browserSurfaceRequest(surface, "session-a", "input", { method: "POST" });
  const viewportA = browserSurfaceRequest(surface, "session-a", "viewport", { method: "POST" });
  assert.ok(frameA);
  assert.ok(navigationA);
  assert.ok(inputA);
  assert.ok(viewportA);
  surface.observeServerUrl("session-a", "https://a.example");
  assert.equal(surface.syncViewport("session-a", { height: 600, width: 800 }), true);
  assert.equal(surface.syncViewport("session-a", { height: 600, width: 800 }), false);

  surface.enterSession("session-b", "https://a.example");

  assert.equal(frameA.signal.aborted, true);
  assert.equal(navigationA.signal.aborted, true);
  assert.equal(inputA.controller.signal.aborted, true);
  assert.equal(viewportA.controller.signal.aborted, true);
  assert.equal(surface.ownsSession("session-a"), false);
  assert.equal(surface.ownsSession("session-b"), true);
  assert.equal(surface.requestController("session-a"), null);
  assert.equal(surface.navigationTarget("session-b", "https://a.example"), null);
  assert.equal(surface.syncViewport("session-b", { height: 600, width: 800 }), true);
  assert.deepEqual(surface.viewport(), { height: 600, width: 800 });

  surface.observeServerUrl("session-b", "https://b.example");
  assert.equal(surface.navigationTarget("session-b", "https://b.example"), null);
  assert.equal(surface.navigationTarget("session-b", "https://a.example"), "https://a.example");
  assert.equal(
    surface.navigationTarget("session-b", "https://next.example"),
    "https://next.example",
  );
});

test("disposing a keyed surface aborts pending session traffic", () => {
  const surface = new BrowserSessionSurface();
  surface.enterSession("session-a", "https://a.example");
  const input = browserSurfaceRequest(surface, "session-a", "input", { method: "POST" });
  assert.ok(input);
  surface.dispose();
  assert.equal(input.controller.signal.aborted, true);
  assert.equal(surface.ownsSession("session-a"), false);
  surface.dispose();
});

test("reattaching a keyed surface restores traffic after a Strict Mode ref cleanup", () => {
  const surface = new BrowserSessionSurface("session-a", "https://a.example");
  const first = surface.requestController("session-a");
  assert.ok(first);
  surface.dispose();
  assert.equal(first.signal.aborted, true);
  assert.equal(surface.requestController("session-a"), null);
  surface.attach();
  assert.ok(surface.requestController("session-a"));
  assert.equal(surface.navigationTarget("session-a", "https://a.example"), null);
});
