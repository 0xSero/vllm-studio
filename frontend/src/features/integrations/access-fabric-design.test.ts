import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./access-fabric-panel.tsx", import.meta.url), "utf8");
const integrations = readFileSync(new URL("./integrations-page.tsx", import.meta.url), "utf8");

describe("access fabric integration panel", () => {
  it("separates handling classification from HashiCorp Boundary", () => {
    assert.match(source, /C2 handling boundary · access fabric/);
    assert.match(source, /HashiCorp Boundary targets/);
    assert.match(source, /not the C2 classification boundary/);
  });

  it("blocks verification of unsaved changes and clears submitted credentials", () => {
    assert.match(source, /Boolean\(busy\) \|\| dirty/);
    assert.match(source, /setCredentials\(\{ netbird: "", boundary: "" \}\)/);
    assert.match(source, /type="password"/);
    assert.match(source, /autoComplete="off"/);
  });

  it("hydrates navigation from a stable server state", () => {
    assert.match(integrations, /useState<IntegrationSectionId>\("onboarding"\)/);
    assert.match(integrations, /useMountSubscription/);
    assert.doesNotMatch(integrations, /typeof window === "undefined"/);
  });

  it("uses proof color only for attested receipts and compact digests", () => {
    assert.match(source, /state\.receipt \? "text-\(--proof\)"/);
    assert.match(source, /compactDigest\(state\.receipt\.profileDigest\)/);
    assert.match(source, /min-h-11/);
    assert.doesNotMatch(source, /rounded-(full|xl|2xl|3xl)/);
  });
});
