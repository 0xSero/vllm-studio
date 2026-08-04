import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sessionTitleFromPrompt } from "./helpers";

describe("sessionTitleFromPrompt", () => {
  test("derives a title after the internal browser context envelope", () => {
    assert.equal(
      sessionTitleFromPrompt(
        "<browser_context>\nA server-side browser is available.\n</browser_context>\n\nReview the release status",
      ),
      "Review the release status",
    );
  });

  test("preserves legitimate user text containing the context tag name", () => {
    assert.equal(
      sessionTitleFromPrompt("Explain <browser_context> in this XML document"),
      "Explain <browser_context> in this XML document",
    );
  });
});
