import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isAppUpdateAvailable, isNewerVersion, isReleaseUpdateAvailable } from "./use-app-update";

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

describe("isAppUpdateAvailable", () => {
  test("shows only when the Stable feed is newer than the installed app", () => {
    assert.equal(isAppUpdateAvailable("2.8.1", "2.8.0"), true);
    assert.equal(isAppUpdateAvailable("2.8.1", "2.8.1"), false);
    assert.equal(isAppUpdateAvailable("2.8.0", "2.8.1"), false);
  });

  test("stays hidden until both versions are known", () => {
    assert.equal(isAppUpdateAvailable(null, "2.8.1"), false);
    assert.equal(isAppUpdateAvailable("2.8.1", null), false);
  });
});

describe("isReleaseUpdateAvailable", () => {
  test("offers stable updates only to stable packaged builds", () => {
    assert.equal(isReleaseUpdateAvailable("2.9.3", "2.1.0", "stable"), true);
    assert.equal(isReleaseUpdateAvailable("2.9.3", "2.1.0", "dev"), false);
    assert.equal(isReleaseUpdateAvailable("2.9.3", "2.1.0", null), false);
  });
});
