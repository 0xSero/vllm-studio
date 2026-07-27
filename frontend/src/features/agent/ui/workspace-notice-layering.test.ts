import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const workspaceShell = readFileSync(
  new URL("./agent-workspace-shell.tsx", import.meta.url),
  "utf8",
);

describe("workspace notice positioning", () => {
  test("keeps notices below the toolbar and clear of the composer", () => {
    assert.match(
      workspaceShell,
      /absolute right-3 top-\[calc\(var\(--h-toolbar-pane\)\+0\.75rem\)\] z-\[110\]/,
    );
    assert.doesNotMatch(workspaceShell, /absolute bottom-3 right-3 z-30/);
  });
});
