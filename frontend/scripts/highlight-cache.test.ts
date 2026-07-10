import assert from "node:assert/strict";
import test from "node:test";
import { highlightFenced } from "../src/features/agent/highlight-cache";

test("highlights code languages used by the filesystem and tool previews", () => {
  assert.match(highlightFenced("css", ".card { color: red; }"), /hljs-selector-class/);
  assert.match(highlightFenced("java", "class Studio {}"), /hljs-keyword/);
  assert.match(highlightFenced("toml", "port = 8080"), /hljs-attr/);
});
