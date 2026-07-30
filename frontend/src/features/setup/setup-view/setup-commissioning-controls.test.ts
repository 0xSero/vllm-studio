import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("setup commissioning controls", () => {
  const access = source("step-access.tsx");
  const environment = source("step-environment.tsx");
  const tensorprime = source("tensorprime-commissioning.tsx");
  const hook = source("../use-commissioning-profile.ts");

  test("keeps credentials write-only and commissioning state server-owned", () => {
    assert.match(access, /type="password"/);
    assert.match(access, /autoComplete="off"/);
    assert.match(access, /\/api\/settings\/controller-credential/);
    assert.doesNotMatch(access, /localStorage|sessionStorage/);
    assert.doesNotMatch(hook, /localStorage|sessionStorage/);
  });

  test("separates probe projections from the authoritative runtime catalog", () => {
    assert.match(tensorprime, /tensorprime_probes/);
    assert.match(tensorprime, /probe projection/);
    assert.match(tensorprime, /catalog_service_id/);
    assert.doesNotMatch(tensorprime, /service catalog/);
  });

  test("does not present Phase 0 workload identity as service mTLS enforcement", () => {
    assert.match(environment, /does not establish/);
    assert.match(tensorprime, /Service mTLS/);
    assert.match(tensorprime, /service_mtls/);
    assert.doesNotMatch(tensorprime, /attested/);
  });

  test("uses labeled controls, live regions, semantic tokens, and no fixed colors", () => {
    assert.match(access, /key: "issuer", label: "Issuer URL"/);
    assert.match(access, /aria-live="polite"/);
    assert.match(tensorprime, /aria-label=.*probe projection/);
    assert.doesNotMatch(`${access}\n${tensorprime}`, /#[0-9a-fA-F]{3,8}/);
  });
});
