import assert from "node:assert/strict";
import test from "node:test";

import {
  exportFilenameFromTitle,
  sessionToMarkdown,
} from "@/features/agent/messages/export-markdown";
import type { ChatMessage } from "@/features/agent/messages";

function user(text: string): ChatMessage {
  return { id: `u-${text}`, role: "user", text };
}

function assistant(text: string, blocks?: ChatMessage["blocks"]): ChatMessage {
  return { id: `a-${text}`, role: "assistant", text, blocks };
}

test("serializes a transcript under You/Assistant headings with a title", () => {
  const md = sessionToMarkdown([user("hello"), assistant("hi there")], "My chat");
  assert.equal(md, "# My chat\n\n## You\n\nhello\n\n## Assistant\n\nhi there\n");
});

test("prefers assistant text blocks and drops reasoning/tool/system noise", () => {
  const md = sessionToMarkdown(
    [
      { id: "s", role: "system", text: "ignore me" },
      user("q"),
      assistant("", [
        { kind: "thinking", id: "t", text: "secret reasoning" },
        { kind: "text", id: "x", text: "the answer" },
      ]),
    ],
    undefined,
  );
  assert.equal(md, "## You\n\nq\n\n## Assistant\n\nthe answer\n");
  assert.ok(!md.includes("secret reasoning"));
  assert.ok(!md.includes("ignore me"));
});

test("skips empty turns", () => {
  const md = sessionToMarkdown([user("only this"), assistant("   ")], "T");
  assert.equal(md, "# T\n\n## You\n\nonly this\n");
});

test("filename is slugified and falls back to chat.md", () => {
  assert.equal(exportFilenameFromTitle("Make a Table!"), "make-a-table.md");
  assert.equal(exportFilenameFromTitle("   "), "chat.md");
  assert.equal(exportFilenameFromTitle(undefined), "chat.md");
});
