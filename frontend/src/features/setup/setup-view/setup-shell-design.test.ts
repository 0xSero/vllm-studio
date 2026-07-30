import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("setup commissioning design contract", () => {
  const shell = source("setup-shell.tsx");
  const view = source("setup-view.tsx");
  const setupHook = source("../use-setup.ts");
  const appShell = source("../../shell/left-sidebar.tsx");
  const tokens = source("../../../app/styles/globals/tokens.css");

  test("presents appliance identity and a single labeled setup region", () => {
    assert.match(shell, /<ApplianceBrandMark/);
    assert.doesNotMatch(shell, /<AuthorityFooter/);
    assert.match(appShell, /<AuthorityFooter/);
    assert.match(shell, /href="#setup-content"/);
    assert.match(shell, /<section/);
    assert.doesNotMatch(shell, /<main/);
    assert.match(shell, /aria-labelledby="setup-title"/);
    assert.match(shell, /aria-label="Setup stages"/);
    assert.match(shell, /aria-label="Setup evidence"/);
  });

  test("uses evidence-accurate commissioning language", () => {
    assert.match(view, /Set the model store/);
    assert.match(view, /Qualify the workstation/);
    assert.match(view, /Select an admitted model/);
    assert.match(view, /Acquire the model weights/);
    assert.match(view, /Launch the inference runtime/);
    assert.match(view, /Verify the serving path/);
    assert.match(shell, /evidence \?\? \[\]/);
    assert.match(shell, /cryptographic attestation is not claimed/);
    assert.doesNotMatch(shell, />\s*LS\s*</);
  });

  test("maps every persisted inference transition and exposes the environment tracks", () => {
    for (const step of [0, 1, 2, 3, 4, 5]) {
      assert.match(view, new RegExp(`steps: \\[${step}\\]`));
    }
    assert.match(view, /shortTitle: "Storage"/);
    assert.match(view, /shortTitle: "Runtime"/);
    assert.match(view, /shortTitle: "Model"/);
    assert.match(view, /shortTitle: "Acquire"/);
    assert.match(view, /shortTitle: "Serve"/);
    assert.match(view, /shortTitle: "Verify"/);
    assert.match(view, /shortTitle: "Access"/);
    assert.match(view, /shortTitle: "Credentials"/);
    assert.match(view, /shortTitle: "Environment"/);
    assert.match(view, /shortTitle: "Inference"/);
    assert.match(view, /shortTitle: "Review"/);
    assert.match(view, /<StepAccess/);
    assert.match(view, /<AgentOnboardingWizard embedded/);
    assert.match(view, /<StepEnvironment/);
    assert.match(view, /useCommissioningReadiness/);
    assert.match(view, /Complete commissioning/);
    assert.doesNotMatch(view, /standing: "Available"/);
  });

  test("keeps setup geometry technical and token-driven", () => {
    assert.match(shell, /\[&_button\]:rounded-\[var\(--rad-sm\)\]/);
    assert.doesNotMatch(shell, /rounded-(full|xl|2xl|3xl)/);
    assert.doesNotMatch(shell, /#[0-9a-fA-F]{3,8}/);
    assert.match(shell, /Exit without completing/);
    const exitSetup = setupHook.match(/const exitSetup[\s\S]*?\}, \[router\]\);/)?.[0] ?? "";
    assert.match(exitSetup, /router\.push\("\/"\)/);
    assert.doesNotMatch(exitSetup, /markSetupComplete/);
    assert.match(setupHook, /const completeSetup[\s\S]*?markSetupComplete/);
  });

  test("resolves the four required cortAIx modes", () => {
    assert.match(tokens, /data-theme="cortaix-light"/);
    assert.match(tokens, /data-theme="cortaix-dark"/);
    assert.match(tokens, /data-contrast-mode="high"/);
    assert.match(tokens, /@media \(forced-colors: active\)/);
  });
});
