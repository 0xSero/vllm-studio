import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHighlightCacheForTests,
  escapeHighlightHtml,
  highlightCacheSizeForTests,
  highlightFenced,
  isHighlightCacheEntryCachedForTests,
} from "./highlight-cache";

describe("highlight-cache", () => {
  beforeEach(() => {
    clearHighlightCacheForTests();
  });

  it("highlights and reuses a cached language/code entry", () => {
    const code = "const value = 1;";

    const first = highlightFenced("ts", code);
    const second = highlightFenced("ts", code);

    expect(first).toBe(second);
    expect(first).toContain("hljs-keyword");
    expect(first).toContain("hljs-number");
    expect(highlightCacheSizeForTests()).toBe(1);
    expect(isHighlightCacheEntryCachedForTests("ts", code)).toBe(true);
  });

  it("falls back through auto-detection for unknown languages", () => {
    const highlighted = highlightFenced("made-up-language", "const value = 1;");

    expect(highlighted).toContain("hljs-keyword");
    expect(highlighted).toContain("value");
  });

  it("escapes fallback HTML without styling", () => {
    expect(escapeHighlightHtml("<script>alert('x') & more</script>")).toBe(
      "&lt;script&gt;alert(&#39;x&#39;) &amp; more&lt;/script&gt;",
    );
  });

  it("evicts least-recently-used entries beyond the bounded cap", () => {
    const firstCode = "const entry0 = 0;";
    highlightFenced("ts", firstCode);

    for (let index = 1; index <= 256; index += 1) {
      highlightFenced("ts", `const entry${index} = ${index};`);
    }

    expect(highlightCacheSizeForTests()).toBe(256);
    expect(isHighlightCacheEntryCachedForTests("ts", firstCode)).toBe(false);
    expect(isHighlightCacheEntryCachedForTests("ts", "const entry256 = 256;")).toBe(true);
  });
});
