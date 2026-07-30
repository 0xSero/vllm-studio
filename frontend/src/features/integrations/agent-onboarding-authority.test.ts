import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const wizard = source("./agent-onboarding-wizard.tsx");
const onboardingLifecycle = source(
  "../../../../services/agent-runtime/src/agent-onboarding-lifecycle.ts",
);

describe("agent onboarding authority boundaries", () => {
  test("derives readiness and enrollment only from controller state", () => {
    assert.match(wizard, /decodeState\(nextState\)/);
    assert.match(wizard, /state\.receipt/);
    assert.match(wizard, /state\.probes\.find/);
    assert.match(wizard, /Date\.parse\(result\.checkedAt\)/);
    assert.doesNotMatch(wizard, /setState\([^)]*connected/i);
  });

  test("requires successful evidence no older than ten minutes before apply", () => {
    assert.match(onboardingLifecycle, /Date\.now\(\) - 10 \* 60 \* 1000/);
    assert.match(onboardingLifecycle, /!probe\?\.ok/);
    assert.match(onboardingLifecycle, /Secure credentials required/);
    assert.match(onboardingLifecycle, /probe\.profileDigest !== digest/);
    assert.match(onboardingLifecycle, /Date\.parse\(probe\.checkedAt\) < cutoff/);
    assert.match(onboardingLifecycle, /Current successful probes required/);
  });

  test("rolls back failed attachments and restores receipt-backed changes on revoke", () => {
    assert.match(onboardingLifecycle, /if \(failed\.length\)/);
    assert.match(onboardingLifecycle, /await revokeAgentAttachments\(os\.homedir\(\), results\)/);
    assert.match(onboardingLifecycle, /state\.recovery\?\.localAgentResults/);
    assert.match(onboardingLifecycle, /localAgentResults as AttachResult\[\]/);
    assert.match(onboardingLifecycle, /failure\.startsWith\("remote connector:"\)/);
    assert.match(onboardingLifecycle, /Effect\.runPromise\(clearOnboardingReceipt\(\)\)/);
  });
});
