import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const panel = readFileSync(new URL("./provisioning-panel.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("./integrations-page.tsx", import.meta.url), "utf8");
const tokens = readFileSync(
  new URL("../../app/styles/globals/tokens.css", import.meta.url),
  "utf8",
);

describe("provisioning coordinator surface", () => {
  test("drives one reversible coordinator lifecycle without duplicating participant forms", () => {
    for (const label of [
      "Setup admitted plan",
      "Reconcile participants",
      "Offboard all",
      "Recover transaction",
    ]) {
      assert.match(panel, new RegExp(label));
    }
    assert.match(panel, /Participant lineage/);
    assert.match(panel, /state\.recovery\.pending/);
    assert.match(page, /<ProvisioningPanel \/>/);
    assert.doesNotMatch(panel, /credential|sshTarget|managementUrl|executionHome/);
  });

  test("keeps unsigned lineage observed and recovery contradicted", () => {
    assert.doesNotMatch(panel, /attested|text-\(--proof\)/);
    assert.match(panel, /state="contradicted">Recovery required/);
    assert.match(panel, /mode changes deployment, not governance semantics/);
  });

  test("is hydration-stable and resolves all display modes", () => {
    assert.doesNotMatch(panel, /Date\.now|Math\.random|typeof window|toLocale/);
    assert.match(panel, /useState<ProvisioningState \| null>\(null\)/);
    assert.match(panel, /forced-colors:border-\[CanvasText\]/);
    assert.match(tokens, /data-theme="cortaix-light"/);
    assert.match(tokens, /data-theme="cortaix-dark"/);
    assert.match(tokens, /data-contrast-mode="high"/);
    assert.match(tokens, /@media \(forced-colors: active\)/);
  });
});
