import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssistantBlock, ChatMessage } from "@/lib/agent/session";
import { groupAssistantBlocks, SessionPaneBlockRouter } from "./session-pane-block-router";

describe("groupAssistantBlocks", () => {
  it("starts a new activity group after assistant content", () => {
    const blocks: AssistantBlock[] = [
      { kind: "thinking", id: "think", text: "plan" },
      { kind: "thinking", id: "think-2", text: "more plan" },
      { kind: "tool", id: "tool-1", name: "read_file", status: "done", text: "" },
      { kind: "tool", id: "tool-2", name: "write_file", status: "done", text: "" },
      { kind: "text", id: "text", text: "done" },
      { kind: "tool", id: "tool-3", name: "bash", status: "done", text: "" },
    ];

    expect(groupAssistantBlocks(blocks)).toEqual([
      {
        kind: "activity-group",
        id: "activity-reasoning-think",
        segments: [
          { kind: "reasoning", id: "reasoning-think", blocks: [blocks[0], blocks[1]] },
          { kind: "tools", id: "tools-tool-1", blocks: [blocks[2], blocks[3]] },
        ],
      },
      { kind: "content", block: blocks[4] },
      {
        kind: "activity-group",
        id: "activity-tools-tool-3",
        segments: [{ kind: "tools", id: "tools-tool-3", blocks: [blocks[5]] }],
      },
    ]);
  });

  it("ignores empty text blocks so they don't split a single activity group", () => {
    const blocks: AssistantBlock[] = [
      { kind: "thinking", id: "think-1", text: "plan" },
      { kind: "tool", id: "tool-1", name: "ls", status: "done", text: "" },
      { kind: "text", id: "empty", text: "" },
      { kind: "thinking", id: "think-2", text: "more" },
      { kind: "tool", id: "tool-2", name: "bash", status: "done", text: "" },
    ];

    expect(groupAssistantBlocks(blocks)).toEqual([
      {
        kind: "activity-group",
        id: "activity-reasoning-think-1",
        segments: [
          { kind: "reasoning", id: "reasoning-think-1", blocks: [blocks[0]] },
          { kind: "tools", id: "tools-tool-1", blocks: [blocks[1]] },
          { kind: "reasoning", id: "reasoning-think-2", blocks: [blocks[3]] },
          { kind: "tools", id: "tools-tool-2", blocks: [blocks[4]] },
        ],
      },
    ]);
  });

  it("keeps interleaved reasoning and tools in one ordered activity group", () => {
    const blocks: AssistantBlock[] = [
      { kind: "thinking", id: "think-1", text: "inspect" },
      { kind: "tool", id: "tool-1", name: "read_file", status: "done", text: "" },
      { kind: "thinking", id: "think-2", text: "adjust" },
      { kind: "tool", id: "tool-2", name: "apply_patch", status: "done", text: "" },
    ];

    expect(groupAssistantBlocks(blocks)).toEqual([
      {
        kind: "activity-group",
        id: "activity-reasoning-think-1",
        segments: [
          { kind: "reasoning", id: "reasoning-think-1", blocks: [blocks[0]] },
          { kind: "tools", id: "tools-tool-1", blocks: [blocks[1]] },
          { kind: "reasoning", id: "reasoning-think-2", blocks: [blocks[2]] },
          { kind: "tools", id: "tools-tool-2", blocks: [blocks[3]] },
        ],
      },
    ]);
  });
});

describe("SessionPaneBlockRouter", () => {
  it("renders sent image, video, and PDF attachments inside the user bubble", () => {
    const message: ChatMessage = {
      id: "user",
      role: "user",
      text: "look at these",
      attachments: [
        {
          id: "image",
          name: "image.png",
          type: "image/png",
          size: 123,
          mode: "metadata",
          content: "",
          previewKind: "image",
          previewUrl: "blob:image",
        },
        {
          id: "video",
          name: "clip.mp4",
          type: "video/mp4",
          size: 456,
          mode: "metadata",
          content: "",
          previewKind: "video",
          previewUrl: "blob:video",
        },
        {
          id: "pdf",
          name: "paper.pdf",
          type: "application/pdf",
          size: 789,
          mode: "metadata",
          content: "",
          previewKind: "pdf",
          previewUrl: "blob:pdf",
        },
      ],
    };

    const html = renderToStaticMarkup(<SessionPaneBlockRouter message={message} />);

    expect(html).toContain("look at these");
    expect(html).toContain("<img");
    expect(html).toContain("<video");
    expect(html).toContain("<iframe");
    expect(html).toContain("image.png");
    expect(html).toContain("clip.mp4");
    expect(html).toContain("paper.pdf");
  });

  it("keeps mixed reasoning and finished tools collapsed as a preview", () => {
    const message: ChatMessage = {
      id: "assistant",
      role: "assistant",
      text: "",
      blocks: [
        { kind: "thinking", id: "think-1", text: "private plan text" },
        {
          kind: "tool",
          id: "tool-1",
          name: "read_file",
          status: "done",
          text: "",
          args: { path: "src/app.ts" },
        },
      ],
    };

    const html = renderToStaticMarkup(<SessionPaneBlockRouter message={message} />);

    expect(html).toContain("Reasoning + 1 tool");
    expect(html).toContain("read app.ts");
    expect(html).not.toContain("private plan text");
  });

  it("keeps running reasoning and tools collapsed behind a status preview", () => {
    const message: ChatMessage = {
      id: "assistant",
      role: "assistant",
      text: "",
      blocks: [
        { kind: "thinking", id: "think-1", text: "noisy live reasoning" },
        {
          kind: "tool",
          id: "tool-1",
          name: "bash",
          status: "running",
          text: "",
          args: { cmd: "ssh -i ~/.ssh/linux-ai ser@100.90.62.80 'nvidia-smi'" },
        },
      ],
    };

    const html = renderToStaticMarkup(<SessionPaneBlockRouter message={message} />);

    expect(html).toContain("Reasoning + 1 tool");
    expect(html).toContain("running");
    expect(html).toContain("ssh -i");
    expect(html).not.toContain("noisy live reasoning");
    expect(html).not.toContain("Ran command");
  });

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
    expect(html).toContain("npm test");
    expect(html).not.toContain("edit example.ts");
    expect(html).not.toContain("border border-(--border)/70");
    expect(html).not.toContain("language-ts");
  });
});
