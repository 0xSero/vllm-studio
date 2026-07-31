import assert from "node:assert/strict";
import test from "node:test";
import { releasePackageArguments } from "./release-package-arguments.mjs";

test("release signing packaging never publishes implicitly", () => {
  const args = releasePackageArguments({
    app: "/tmp/Local Studio.app",
    version: "2.9.0",
    commit: "0123456789abcdef",
  });

  assert.deepEqual(args.slice(-2), ["--publish", "never"]);
  assert.deepEqual(args.slice(0, 2), ["--prepackaged", "/tmp/Local Studio.app"]);
});
