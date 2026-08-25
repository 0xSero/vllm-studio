import { describe, expect, test } from "bun:test";
import { TranscriptProjector, projectSnapshot, projectTranscript } from "../src/pi/projection";

const assistant = (overrides: Record<string, unknown> = {}) => ({
  role: "assistant",
  content: [
    { type: "thinking", thinking: "hm" },
    { type: "text", text: "hello" },
    { type: "toolCall", id: "call-1", name: "read", arguments: { path: "/x" } },
  ],
  provider: "local",
  model: "glm",
  usage: {
    input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "toolUse",
  timestamp: 1000,
  ...overrides,
});

describe("projectTranscript", () => {
  test("maps user, assistant, and tool-result messages with statuses", () => {
    const items = projectTranscript([
      { role: "user", content: "hi", timestamp: 500 },
      assistant(),
      {
        role: "toolResult", toolCallId: "call-1", toolName: "read",
        content: [{ type: "text", text: "file body" }], isError: false, timestamp: 1500,
      },
    ]);
    expect(items.map((item) => item.role)).toEqual(["user", "assistant", "tool"]);
    const [user, message, tool] = items;
    expect(user).toMatchObject({ content: [{ type: "text", text: "hi" }] });
    expect(message).toMatchObject({ status: "complete", stopReason: "toolUse" });
    // The tool item inherits the call's input from the owning assistant message.
    expect(tool).toMatchObject({
      id: "tool:call-1", status: "complete", isError: false, input: { path: "/x" },
    });
  });

  test("aborted and error stop reasons carry their status", () => {
    const [aborted] = projectTranscript([assistant({ stopReason: "aborted" })]);
    const [failed] = projectTranscript([assistant({ stopReason: "error", errorMessage: "boom" })]);
    expect(aborted).toMatchObject({ status: "aborted", stopReason: "aborted" });
    expect(failed).toMatchObject({ status: "error", errorMessage: "boom" });
  });

  test("custom message roles are skipped", () => {
    expect(projectTranscript([{ role: "bashExecution", command: "ls" }])).toEqual([]);
  });
});

describe("TranscriptProjector", () => {
  test("streaming deltas map to assistant_delta at the same content index", () => {
    const projector = new TranscriptProjector();
    const partial = assistant({ stopReason: "pending" });
    const [progress] = projector.progressFor({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "lo", partial },
    } as never);
    expect(progress).toMatchObject({
      type: "assistant_delta", messageId: "assistant:1000", contentIndex: 1, kind: "text", delta: "lo",
    });
  });

  test("part boundaries re-send the item; message_end finishes it", () => {
    const projector = new TranscriptProjector();
    const partial = assistant({ stopReason: "pending" });
    const [updated] = projector.progressFor({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 2, partial },
    } as never);
    expect(updated).toMatchObject({ type: "item_updated", item: { status: "streaming" } });
    const [finished] = projector.progressFor({
      type: "message_end", message: assistant(),
    } as never);
    expect(finished).toMatchObject({ type: "item_finished", item: { status: "complete" } });
  });

  test("progress ids agree with snapshot ids so replacement is seamless", () => {
    const projector = new TranscriptProjector();
    const [started] = projector.progressFor({ type: "message_start", message: assistant({ stopReason: "pending" }) } as never);
    const snapshot = projectSnapshot({
      sessionId: "s1", cwd: "/w", messages: [assistant()], phase: "idle",
      model: { provider: "local", id: "glm" }, thinkingLevel: "off", queuedSteer: [], revision: 7,
    });
    const startedItem = (started as { item: { id: string } }).item;
    expect(snapshot.transcript.some((item) => item.id === startedItem.id)).toBe(true);
    expect(snapshot.revision).toBe(7);
  });

  test("tool execution start/end become running then finished tool items", () => {
    const projector = new TranscriptProjector();
    const [started] = projector.progressFor({
      type: "tool_execution_start", toolCallId: "call-9", toolName: "bash", args: { cmd: "ls" },
    } as never);
    expect(started).toMatchObject({ type: "item_started", item: { id: "tool:call-9", status: "running" } });
    const [updated] = projector.progressFor({
      type: "tool_execution_update", toolCallId: "call-9", toolName: "bash", args: { cmd: "ls" },
      partialResult: { content: [{ type: "text", text: "partial" }], details: { lines: 3 } },
    } as never);
    expect(updated).toMatchObject({
      type: "item_updated",
      item: {
        id: "tool:call-9",
        status: "running",
        details: { lines: 3 },
        content: [{ type: "text", text: "partial" }],
      },
    });
    const [finished] = projector.progressFor({
      type: "tool_execution_end", toolCallId: "call-9", toolName: "bash", args: { cmd: "ls" },
      isError: false, result: { content: [{ type: "text", text: "ok" }], details: { exit: 0 } },
    } as never);
    expect(finished).toMatchObject({
      type: "item_finished",
      item: { id: "tool:call-9", status: "complete", details: { exit: 0 } },
    });
  });

  test("user entries surface via entry_appended; assistant entries do not duplicate", () => {
    const projector = new TranscriptProjector();
    const [user] = projector.progressFor({
      type: "entry_appended",
      entry: { type: "message", message: { role: "user", content: "steer", timestamp: 2000 } },
    } as never);
    expect(user).toMatchObject({ type: "item_started", item: { role: "user" } });
    expect(
      projector.progressFor({
        type: "entry_appended",
        entry: { type: "message", message: assistant() },
      } as never),
    ).toEqual([]);
  });
});
