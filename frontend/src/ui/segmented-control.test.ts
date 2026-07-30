import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentedControl, nextSegmentedIndex } from "./segmented-control";

describe("segmented control", () => {
  test("wraps arrow navigation and supports boundary keys", () => {
    assert.equal(nextSegmentedIndex(0, 2, "ArrowRight"), 1);
    assert.equal(nextSegmentedIndex(1, 2, "ArrowRight"), 0);
    assert.equal(nextSegmentedIndex(0, 2, "ArrowLeft"), 1);
    assert.equal(nextSegmentedIndex(1, 2, "Home"), 0);
    assert.equal(nextSegmentedIndex(0, 2, "End"), 1);
    assert.equal(nextSegmentedIndex(0, 2, "Enter"), null);
  });

  test("renders one keyboard tab stop with an accessible group name", () => {
    const markup = renderToStaticMarkup(
      createElement(SegmentedControl, {
        items: [
          { id: "light", label: "Light" },
          { id: "dark", label: "Dark" },
        ],
        value: "light",
        onChange: () => undefined,
        ariaLabel: "Color mode",
      }),
    );
    assert.match(markup, /role="tablist"/);
    assert.match(markup, /aria-label="Color mode"/);
    assert.match(markup, /aria-orientation="horizontal"/);
    assert.match(markup, /aria-selected="true"[^>]*tabindex="0"/);
    assert.match(markup, /aria-selected="false"[^>]*tabindex="-1"/);
  });
});
