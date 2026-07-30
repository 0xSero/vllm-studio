import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isNewerVersion } from "./use-app-update";

describe("isNewerVersion", () => {
  test("orders numerically per segment, not lexically", () => {
    assert.equal(isNewerVersion("2.10.0", "2.9.9"), true);
    assert.equal(isNewerVersion("2.9.9", "2.10.0"), false);
    assert.equal(isNewerVersion("3.0.0", "2.99.99"), true);
  });

  test("equal and older versions are not updates", () => {
    assert.equal(isNewerVersion("2.7.0", "2.7.0"), false);
    assert.equal(isNewerVersion("2.6.9", "2.7.0"), false);
  });

  test("tolerates missing segments and junk", () => {
    assert.equal(isNewerVersion("2.8", "2.7.3"), true);
    assert.equal(isNewerVersion("2.7", "2.7.0"), false);
    assert.equal(isNewerVersion("nonsense", "2.7.0"), false);
  });
});
