import assert from "node:assert/strict";
import test from "node:test";

import { buildUntrackedFileDiffBlock } from "@/features/agent/git";
import { parseUnifiedDiff } from "@/features/agent/ui/git-diff-panel-model";

test("an untracked file renders as a GitHub-style new-file diff", () => {
  const { block, additions } = buildUntrackedFileDiffBlock(
    "app/page.tsx",
    "export const Page = () => null;\nexport default Page;\n",
  );
  assert.equal(additions, 2);
  const files = parseUnifiedDiff(block);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "app/page.tsx");
  assert.equal(files[0].additions, 2);
  assert.equal(files[0].deletions, 0);
  // The body lines are real additions the panel will render.
  const addedText = files[0].lines.filter((l) => l.kind === "add").map((l) => l.text);
  assert.deepEqual(addedText, ["export const Page = () => null;", "export default Page;"]);
});

test("a binary untracked file emits a marker, not its bytes", () => {
  const { block, additions } = buildUntrackedFileDiffBlock("logo.png", "PNG\0binary");
  assert.equal(additions, 0);
  assert.match(block, /Binary files \/dev\/null and b\/logo\.png differ/);
  assert.equal(block.includes("+PNG"), false);
  // Still parses as a file entry (so it appears in the list) with no additions.
  const files = parseUnifiedDiff(block);
  assert.equal(files[0].path, "logo.png");
  assert.equal(files[0].additions, 0);
});

test("a long untracked file is truncated but reports its true line count", () => {
  const contents = Array.from({ length: 1500 }, (_, i) => `line ${i}`).join("\n");
  const { block, additions } = buildUntrackedFileDiffBlock("data.js", contents);
  // True line count is preserved for the +N counter even though the body is capped.
  assert.equal(additions, 1500);
  assert.match(block, /more lines not shown/);
  const files = parseUnifiedDiff(block);
  // Rendered rows are capped (1000 shown + 1 truncation marker), not the full 1500.
  assert.ok(files[0].additions <= 1001);
  assert.equal(files[0].path, "data.js");
});
