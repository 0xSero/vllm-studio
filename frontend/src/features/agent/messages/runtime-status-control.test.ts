import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeStatusAcceptsControl } from "./helpers";

test("accepts when the runtime reports an active session", () => {
  assert.equal(runtimeStatusAcceptsControl({ active: true }, "pi-1"), true);
});

test("refuses when the runtime reports the session is not active", () => {
  assert.equal(runtimeStatusAcceptsControl({ active: false }, "pi-1"), false);
});

// The regression this guards: the probe's loader collapses timeouts, 404s and
// decode misses into null. Reading that as a refusal sends a mid-turn message
// down the fresh-prompt path, where the server converts it back into a steer —
// so the user's queued message silently lands in the transcript instead.
test("fails OPEN when the status could not be read", () => {
  assert.equal(runtimeStatusAcceptsControl(null, "pi-1"), true);
  assert.equal(runtimeStatusAcceptsControl(null, null), true);
});

test("refuses when the runtime is serving a different pi session", () => {
  assert.equal(runtimeStatusAcceptsControl({ active: true, piSessionId: "pi-2" }, "pi-1"), false);
});

test("accepts when either side has no pi session to compare", () => {
  assert.equal(runtimeStatusAcceptsControl({ active: true, piSessionId: null }, "pi-1"), true);
  assert.equal(runtimeStatusAcceptsControl({ active: true, piSessionId: "pi-2" }, null), true);
});
