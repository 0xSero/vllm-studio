import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const controls = source("./agent-onboarding-controls.tsx");
const steps = source("./agent-onboarding-service-steps.tsx");
const wizard = source("./agent-onboarding-wizard.tsx");
const tokens = source("../../app/styles/globals/tokens.css");

describe("agent onboarding evidence editorial", () => {
  test("keeps evidence persistent and authority explicit", () => {
    assert.match(wizard, /<header/);
    assert.match(wizard, /<nav/);
    assert.match(wizard, /<main/);
    assert.match(wizard, /<OnboardingEvidenceMargin/);
    assert.match(wizard, /<footer/);
    assert.match(wizard, /Restricted · appliance profile/);
    assert.match(wizard, /mode changes deployment, not governance semantics/);
  });

  test("uses the closed claim vocabulary without promoting an unsigned receipt", () => {
    assert.match(controls, /"observed" \| "claimed" \| "attested" \| "contradicted"/);
    assert.match(controls, /state === "attested" \? "text-\(--proof\)"/);
    assert.match(controls, /compactDigest\(receipt\.profileDigest\)/);
    assert.match(controls, /navigator\.clipboard\.writeText\(receipt\.profileDigest\)/);
    assert.match(controls, /Enrollment receipt · unsigned/);
    assert.doesNotMatch(controls, /Enrollment receipt · signed/);
    assert.doesNotMatch(controls, /ui-success|ui-warning|ui-danger/);
  });

  test("requires revoke before replacing an active enrollment", () => {
    assert.match(wizard, /const replacementPending/);
    assert.match(wizard, /Revoke before reapply/);
    assert.match(steps, /!state\.receipt \? \(/);
    assert.match(steps, /Revoke and restore/);
  });

  test("keeps recovery evidence visible and freezes conflicting mutations", () => {
    assert.match(controls, /Recovery required · \{recovery\.operation\}/);
    assert.match(controls, /recovery\.failures\.map/);
    assert.match(wizard, /<fieldset disabled=\{state\.recovery !== null\}/);
    assert.match(steps, /disabled=\{recoveryRequired\}/);
    assert.match(steps, /Retry recovery/);
  });

  test("resolves appliance light, dark, high contrast, and forced colors", () => {
    assert.match(tokens, /data-theme="cortaix-light"/);
    assert.match(tokens, /data-theme="cortaix-dark"/);
    assert.match(tokens, /data-contrast-mode="high"/);
    assert.match(tokens, /@media \(forced-colors: active\)/);
    assert.match(tokens, /--proof: CanvasText/);
    assert.match(wizard, /forced-colors:border-\[CanvasText\]/);
    assert.match(controls, /forced-colors:border-\[ButtonText\]/);
  });

  test("does not claim skipped steps as completed", () => {
    assert.match(wizard, /aria-current=\{item\.id === step \? "step" : undefined\}/);
    assert.doesNotMatch(wizard, /index < activeIndex \? "⊢"/);
  });
});
