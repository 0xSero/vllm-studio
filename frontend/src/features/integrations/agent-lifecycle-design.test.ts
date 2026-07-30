import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = readFileSync(new URL("./agent-lifecycle-panel.tsx", import.meta.url), "utf8");
const tokens = readFileSync(
  new URL("../../app/styles/globals/tokens.css", import.meta.url),
  "utf8",
);

describe("agent lifecycle evidence surface", () => {
  test("exposes the complete reversible operator lifecycle", () => {
    for (const label of ["Plan setup", "Apply setup", "Reconcile", "Offboard", "Recover"]) {
      assert.match(source, new RegExp(label));
    }
    assert.match(source, /aria-label="Lifecycle evidence"/);
    assert.match(source, /Configuration receipt/);
    assert.match(source, /mode changes deployment, not governance semantics/);
  });

  test("uses semantic theme roles in every supported display mode", () => {
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}/i);
    assert.match(source, /<ClaimMark state="observed">/);
    assert.doesNotMatch(source, /state="attested"/);
    assert.match(source, /forced-colors:border-\[CanvasText\]/);
    assert.match(tokens, /data-theme="cortaix-light"/);
    assert.match(tokens, /data-theme="cortaix-dark"/);
    assert.match(tokens, /data-contrast-mode="high"/);
    assert.match(tokens, /@media \(forced-colors: active\)/);
  });

  test("avoids hydration-variant inputs in initial render", () => {
    assert.doesNotMatch(source, /Date\.now|Math\.random|typeof window|toLocale/);
    assert.match(source, /useState<LifecycleState \| null>\(null\)/);
  });
});
