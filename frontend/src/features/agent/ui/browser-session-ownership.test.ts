import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("closing side chat restores browser ownership to the focused workspace session", () => {
  const panel = source("./agent-browser-panel.tsx");
  assert.match(
    panel,
    /removeDetachedSession[\s\S]*setActiveBrowserSession\(focusedSession\?\.id \?\? null\)[\s\S]*closeComputerTab\("side-chat"\)/,
  );
});

test("clicking an already-focused workspace pane reasserts its browser owner", () => {
  const pane = source("./render-workspace-pane.tsx");
  assert.match(
    pane,
    /onFocus=\{\(\) => \{[\s\S]*setActiveBrowserSession\(view\.pane\.sessionId\)[\s\S]*dispatch\(\{ type: "focusPane"/,
  );
});

test("workspace session changes bind browser ownership during commit", () => {
  const shell = source("./agent-workspace-shell.tsx");
  assert.match(shell, /ref=\{bindActiveSession\}/);
  assert.match(
    shell,
    /useActiveSessionBinder[\s\S]*if \(!node\) return;[\s\S]*setActiveBrowserSession\(browserSessionId\)/,
  );
});
