import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssistantBlock, ChatMessage } from "@/lib/agent/session";
import { groupAssistantBlocks, SessionPaneBlockRouter } from "./session-pane-block-router";

describe("groupAssistantBlocks", () => {
  it("groups consecutive reasoning and tool calls without swallowing content", () => {
    const blocks: AssistantBlock[] = [
      { kind: "thinking", id: "think", text: "plan" },
      { kind: "thinking", id: "think-2", text: "more plan" },
      { kind: "tool", id: "tool-1", name: "read_file", status: "done", text: "" },
      { kind: "tool", id: "tool-2", name: "write_file", status: "done", text: "" },
      { kind: "text", id: "text", text: "done" },
      { kind: "tool", id: "tool-3", name: "bash", status: "done", text: "" },
    ];

    expect(groupAssistantBlocks(blocks)).toEqual([
      { kind: "reasoning-group", id: "reasoning-think", blocks: [blocks[0], blocks[1]] },
      { kind: "tool-group", id: "tools-tool-1", blocks: [blocks[2], blocks[3]] },
      { kind: "content", block: blocks[4] },
      { kind: "tool-group", id: "tools-tool-3", blocks: [blocks[5]] },
    ]);
  });

  it("keeps interleaved reasoning and tools in ordered phases", () => {
    const blocks: AssistantBlock[] = [
      { kind: "thinking", id: "think-1", text: "inspect" },
      { kind: "tool", id: "tool-1", name: "read_file", status: "done", text: "" },
      { kind: "thinking", id: "think-2", text: "adjust" },
      { kind: "tool", id: "tool-2", name: "apply_patch", status: "done", text: "" },
    ];

    expect(groupAssistantBlocks(blocks).map((block) => block.kind)).toEqual([
      "reasoning-group",
      "tool-group",
      "reasoning-group",
      "tool-group",
    ]);
  });
});

describe("SessionPaneBlockRouter", () => {
  it("renders collapsed tool group previews without mounting completed tool details", () => {
    const message: ChatMessage = {
      id: "assistant",
      role: "assistant",
      text: "",
      blocks: [
        {
          kind: "tool",
          id: "tool-1",
          name: "write_file",
          status: "done",
          text: "",
          args: { path: "src/example.ts", content: "const value = 1;" },
        },
        {
          kind: "tool",
          id: "tool-2",
          name: "bash",
          status: "done",
          text: "",
          args: { cmd: "npm test -- tool-block-view.test.tsx" },
        },
      ],
    };

    const html = renderToStaticMarkup(<SessionPaneBlockRouter message={message} />);

    expect(html).toContain("2 tools");
    expect(html).toContain("edit example.ts");
    expect(html).toContain("npm test");
    expect(html).not.toContain("border border-(--border)/70");
    expect(html).not.toContain("language-ts");
  });
});
