import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const runtime = readFileSync(new URL("./agent-runtime-server.ts", import.meta.url), "utf8");
const appServer = readFileSync(new URL("./app-server.ts", import.meta.url), "utf8");

describe("desktop lifecycle credential bootstrap", () => {
  it("creates independent high-entropy runtime credentials and instance identity", () => {
    assert.match(runtime, /randomBytes\(32\)\.toString\("base64url"\)/);
    assert.match(runtime, /LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN: lifecycleToken/);
    assert.match(runtime, /LOCAL_STUDIO_PROVISIONING_TOKEN: lifecycleToken/);
    assert.match(runtime, /options\.lifecycleToken === undefined/);
    assert.match(appServer, /lifecycleToken: process\.env\.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN/);
    assert.match(runtime, /LOCAL_STUDIO_AGENT_RUNTIME_INSTANCE_ID: instanceId/);
    assert.match(runtime, /payload\.instanceId === instanceId/);
    assert.doesNotMatch(runtime, /Using agent runtime at/);
  });

  it("passes lifecycle authority only to the embedded server environment", () => {
    assert.match(appServer, /LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN: agentRuntime\.lifecycleToken/);
    assert.match(appServer, /LOCAL_STUDIO_PROVISIONING_TOKEN: agentRuntime\.lifecycleToken/);
    assert.doesNotMatch(appServer, /log\.[a-z]+\([^)]*lifecycleToken/);
    assert.doesNotMatch(runtime, /log\.[a-z]+\([^)]*lifecycleToken/);
  });
});
