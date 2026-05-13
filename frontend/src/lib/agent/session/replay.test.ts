import { beforeEach, describe, expect, it, vi } from "vitest";
import { replaySessionEvents } from "./replay";

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(1778562000000);
});

describe("replaySessionEvents", () => {
  it("replays session metadata, visible user prompts, and assistant text", () => {
    const replay = replaySessionEvents([
      { type: "session", timestamp: "2026-05-12T02:00:00.000Z" },
      { type: "message", message: { role: "user", content: "system\n\nUser prompt:\nRun tests" } },
      { type: "message_end", message: { role: "assistant", content: "Done" } },
    ]);

    expect(replay.startedAt).toBe("2026-05-12T02:00:00.000Z");
    expect(replay.title).toBe("Run tests");
    expect(replay.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
      { role: "user", text: "Run tests" },
      { role: "assistant", text: "Done" },
    ]);
  });

  it("keeps tool-call and tool-result blocks on the same assistant message", () => {
    const replay = replaySessionEvents([
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Reading" },
            { type: "toolCall", id: "tool-1", name: "read_file", arguments: { path: "a.ts" } },
          ],
        },
      },
      {
        type: "message",
        message: { role: "toolResult", toolCallId: "tool-1", content: "file body" },
      },
    ]);

    expect(replay.messages).toHaveLength(1);
    expect(replay.messages[0]?.blocks).toMatchObject([
      { kind: "text", text: "Reading" },
      { kind: "tool", id: "tool-1", name: "read_file", status: "done", text: "file body" },
    ]);
  });

  it("creates an assistant message from streaming pi deltas", () => {
    const replay = replaySessionEvents([
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hel" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } },
    ]);

    expect(replay.messages).toHaveLength(1);
    expect(replay.messages[0]?.blocks).toEqual([
      expect.objectContaining({ kind: "text", text: "hello" }),
    ]);
  });
});
