import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const devScript = readFileSync(
  new URL("../../../../../../scripts/dev.sh", import.meta.url),
  "utf8",
);

describe("full development stack onboarding authority", () => {
  test("shares one ephemeral internal token with frontend and runtime", () => {
    assert.match(devScript, /randomBytes\(32\)\.toString\("base64url"\)/);
    assert.match(devScript, /export LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN="\$STACK_AGENT_TOKEN"/);
    assert.match(devScript, /export LOCAL_STUDIO_PROVISIONING_TOKEN="\$STACK_AGENT_TOKEN"/);
    assert.doesNotMatch(devScript, /printf.*STACK_AGENT_TOKEN/);
  });
});
