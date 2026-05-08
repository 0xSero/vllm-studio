import { describe, expect, it } from "vitest";
import { drainQueueAfterAgentEnd, replaySessionEvents } from "./chat-pane";

describe("drainQueueAfterAgentEnd", () => {
  it("drops transient steers and returns the next follow-up", () => {
    const result = drainQueueAfterAgentEnd([
      { id: "steer-1", mode: "steer", text: "adjust current run" },
      { id: "follow-1", mode: "follow_up", text: "next prompt" },
      { id: "follow-2", mode: "follow_up", text: "third prompt" },
    ]);

    expect(result.next).toEqual({ id: "follow-1", mode: "follow_up", text: "next prompt" });
    expect(result.remaining).toEqual([{ id: "follow-2", mode: "follow_up", text: "third prompt" }]);
  });

  it("returns an empty drain result when no follow-ups are pending", () => {
    expect(
      drainQueueAfterAgentEnd([{ id: "steer-1", mode: "steer", text: "visible steer" }]),
    ).toEqual({
      next: null,
      remaining: [],
    });
  });
});

describe("replaySessionEvents", () => {
  it("hydrates current Pi message events from stored sessions", () => {
    const result = replaySessionEvents([
      {
        type: "session",
        id: "session-1",
        cwd: "/tmp/project",
      },
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Build the landing page" }],
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "I need to inspect the app." },
            {
              type: "toolCall",
              id: "call-1",
              name: "read",
              arguments: { path: "package.json" },
            },
          ],
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read",
          content: [{ type: "text", text: '{"scripts":{"dev":"next dev"}}' }],
          isError: false,
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done. I found the Next dev script." }],
        },
      },
    ]);

    expect(result.title).toBe("Build the landing page");
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toMatchObject({
      role: "user",
      text: "Build the landing page",
    });
    expect(result.messages[1].blocks).toEqual([
      { kind: "thinking", id: expect.any(String), text: "I need to inspect the app." },
      {
        kind: "tool",
        id: "call-1",
        name: "read",
        status: "done",
        args: { path: "package.json" },
        argsText: '{\n  "path": "package.json"\n}',
        text: '{"scripts":{"dev":"next dev"}}',
      },
    ]);
    expect(result.messages[2]).toMatchObject({
      role: "assistant",
      text: "Done. I found the Next dev script.",
    });
  });

  it("replays streamed tool-call argument deltas from Pi", () => {
    const result = replaySessionEvents([
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 0,
          partial: {
            content: [{ type: "toolCall", id: "call-write", name: "write", arguments: {} }],
          },
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: '{"path":"demo.txt","content":"hel',
          partial: {
            content: [
              {
                type: "toolCall",
                id: "call-write",
                name: "write",
                arguments: { path: "demo.txt", content: "hel" },
              },
            ],
          },
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: 'lo"}',
          partial: {
            content: [
              {
                type: "toolCall",
                id: "call-write",
                name: "write",
                arguments: { path: "demo.txt", content: "hello" },
              },
            ],
          },
        },
      },
    ]);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toEqual([
      {
        kind: "tool",
        id: "call-write",
        name: "write",
        status: "running",
        args: { path: "demo.txt", content: "hello" },
        argsText: '{"path":"demo.txt","content":"hello"}',
        text: "",
      },
    ]);
  });
});
