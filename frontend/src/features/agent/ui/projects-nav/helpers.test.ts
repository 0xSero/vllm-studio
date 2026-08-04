import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { visibleSessionAge } from "./helpers";

describe("visibleSessionAge", () => {
  test("hides timestamps while a session is running", () => {
    assert.equal(visibleSessionAge(true, "2026-07-31T12:00:00.000Z"), "");
  });

  test("hides timestamps beside completion activity", () => {
    assert.equal(visibleSessionAge(false, new Date().toISOString(), true), "");
  });

  test("preserves timestamps for inactive sessions", () => {
    assert.equal(visibleSessionAge(false, new Date().toISOString()), "now");
  });
});
