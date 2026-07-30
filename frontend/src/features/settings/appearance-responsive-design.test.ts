import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const appearance = readFileSync(new URL("./appearance-settings.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../ui/page.tsx", import.meta.url), "utf8");
const segmented = readFileSync(new URL("../../ui/segmented-control.tsx", import.meta.url), "utf8");

describe("appearance responsive design", () => {
  test("keeps routine theme selection on neutral ink", () => {
    assert.doesNotMatch(appearance, /ui-success/);
    assert.match(appearance, />\s*selected\s*</);
  });

  test("names contrast choices and does not promise system mode to the appliance", () => {
    assert.match(appearance, /Follow system/);
    assert.match(appearance, /High contrast/);
    assert.match(appearance, /ariaLabel="Contrast mode"/);
    assert.match(appearance, /Choose the appliance light or dark mode/);
  });

  test("keeps mobile section targets full-width and at least 44 pixels tall", () => {
    assert.match(page, /grid-cols-1/);
    assert.match(page, /sm:grid-cols-2/);
    assert.match(page, /min-h-11 w-full/);
    assert.match(page, /aria-current=\{active \? "page"/);
  });

  test("uses one roving tab stop with visible keyboard focus", () => {
    assert.match(segmented, /tabIndex=\{active \? 0 : -1\}/);
    assert.match(segmented, /focus-visible:ring-2/);
    assert.match(segmented, /ArrowRight/);
    assert.match(segmented, /Home/);
  });
});
