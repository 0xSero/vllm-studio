import assert from "node:assert/strict";
import test from "node:test";

import { isChunkLoadError, recoverByReload } from "@/app/chunk-recovery";

test("isChunkLoadError matches webpack / Next dynamic-import failures", () => {
  assert.equal(
    isChunkLoadError({ name: "ChunkLoadError", message: "Loading chunk 6559 failed." }),
    true,
  );
  assert.equal(
    isChunkLoadError({
      name: "Error",
      message:
        "Loading chunk app/agent/sessions/page failed.\n(missing: /_next/static/chunks/app/agent/sessions/page-fe420677.js)",
    }),
    true,
  );
  assert.equal(isChunkLoadError({ message: "Loading CSS chunk 42 failed" }), true);
  assert.equal(
    isChunkLoadError({
      name: "TypeError",
      message: "Failed to fetch dynamically imported module: https://app/_next/static/chunks/x.js",
    }),
    true,
  );
  assert.equal(
    isChunkLoadError({ name: "TypeError", message: "error loading dynamically imported module" }),
    true,
  );
});

test("isChunkLoadError ignores ordinary render errors", () => {
  assert.equal(
    isChunkLoadError({
      name: "TypeError",
      message: "Cannot read properties of undefined (reading 'map')",
    }),
    false,
  );
  assert.equal(isChunkLoadError({ name: "Error", message: "boom" }), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError(undefined), false);
  assert.equal(isChunkLoadError({}), false);
});

test("recoverByReload is a safe no-op without a browser window", () => {
  // The test runs under Node where `window` is undefined; recovery must not
  // throw and must report that no reload was triggered.
  assert.equal(typeof window, "undefined");
  assert.equal(recoverByReload(), false);
});
