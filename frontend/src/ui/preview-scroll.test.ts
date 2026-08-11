import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  BOTTOM_SLACK_PX,
  PREVIEW_HEIGHT_PX,
  isAtBottom,
  nextLockedState,
} from "./preview-scroll";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("preview height latching", () => {
  test("hugs content until it would exceed the cap", () => {
    const cap = PREVIEW_HEIGHT_PX.md;
    assert.equal(nextLockedState(false, 40, cap), false);
    assert.equal(nextLockedState(false, cap, cap), false);
    assert.equal(nextLockedState(false, cap + 1, cap), true);
  });

  test("never unlatches, so a shrinking stream cannot shift the page", () => {
    const cap = PREVIEW_HEIGHT_PX.md;
    assert.equal(nextLockedState(true, 10, cap), true);
    assert.equal(nextLockedState(true, 0, cap), true);
  });

  test("growing output past the cap latches exactly once", () => {
    const cap = PREVIEW_HEIGHT_PX.sm;
    const heights = [20, 120, 240, 900, 4000];
    const states = heights.reduce<boolean[]>((acc, h) => {
      acc.push(nextLockedState(acc[acc.length - 1] ?? false, h, cap));
      return acc;
    }, []);
    assert.deepEqual(states, [false, false, false, true, true]);
  });
});

describe("stick to bottom", () => {
  test("counts the reader as parked at the bottom within the slack band", () => {
    assert.equal(isAtBottom(1000, 1000 - 320, 320), true);
    assert.equal(isAtBottom(1000, 1000 - 320 - BOTTOM_SLACK_PX, 320), true);
  });

  test("leaves a reader who scrolled up alone", () => {
    assert.equal(isAtBottom(1000, 100, 320), false);
  });
});

describe("preview surfaces", () => {
  test("every streaming preview scrolls inside a PreviewScroll", () => {
    for (const path of [
      "../features/agent/ui/timeline/tool-block-view.tsx",
      "../features/agent/ui/timeline/assistant-activity-group.tsx",
      "../features/agent/ui/assistant-markdown.tsx",
    ]) {
      assert.match(source(path), /<PreviewScroll/);
    }
  });

  test("no preview reintroduces a growing max-height", () => {
    const previews = source("../features/agent/ui/timeline/tool-block-view.tsx");
    assert.doesNotMatch(previews, /max-h-\[\d+px\]/);
  });
});
