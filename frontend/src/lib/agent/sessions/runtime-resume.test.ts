import { describe, expect, it, vi } from "vitest";
import type { RuntimeEventPayload } from "./api";
import { subscribeResumeRuntimeSession } from "./runtime-resume";
import type { Session } from "./types";

const session = (patch: Partial<Session>): Session => ({
  id: "session-1",
  runtimeSessionId: "runtime-1",
  piSessionId: null,
  title: "Session",
  messages: [],
  status: "running",
  error: "",
  input: "",
  ...patch,
});

function harness(initial: Session[]) {
  let handlers: {
    onPayload: (payload: RuntimeEventPayload) => void;
    onError: () => void;
  } | null = null;
  const close = vi.fn();
  const tabsRef = { current: initial };
  const updateSession = vi.fn((sessionId: string, patch: (session: Session) => Session) => {
    tabsRef.current = tabsRef.current.map((entry) =>
      entry.id === sessionId ? patch(entry) : entry,
    );
  });
  const api = {
    loadRuntimeStatus: vi.fn(async () => null),
    subscribeRuntimeEvents: vi.fn(
      (runtime: string, after: number, nextHandlers: typeof handlers) => {
        handlers = nextHandlers;
        return { close };
      },
    ),
  };
  const submitPromptRef = { current: vi.fn(async () => undefined) };
  const schedule = vi.fn((callback: () => void) => callback());
  const deps = {
    after: 4,
    api,
    applyPiEvent: vi.fn(),
    onPiSessionIdChange: vi.fn(),
    runtime: "runtime-1",
    schedule,
    sessionId: "session-1",
    submitPromptRef,
    tabsRef,
    updateSession,
  };
  return {
    close,
    deps,
    get handlers() {
      return handlers;
    },
    submitPromptRef,
    tabsRef,
  };
}

describe("runtime resume subscription", () => {
  it("keeps runtime status and pi event application local to the resume Module", () => {
    const ctx = harness([
      session({
        activeAssistantId: "assistant-1",
        messages: [{ id: "assistant-1", role: "assistant", text: "", blocks: [] }],
      }),
    ]);
    const sub = subscribeResumeRuntimeSession(ctx.deps);

    expect(ctx.deps.api.subscribeRuntimeEvents).toHaveBeenCalledWith(
      "runtime-1",
      4,
      expect.any(Object),
    );
    ctx.handlers?.onPayload({ type: "status", phase: "running", session: { piSessionId: "pi-1" } });
    expect(ctx.tabsRef.current[0]).toMatchObject({ piSessionId: "pi-1", status: "running" });

    const event = {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hi" },
    };
    ctx.handlers?.onPayload({ type: "pi", seq: 7, event });

    expect(ctx.deps.applyPiEvent).toHaveBeenCalledWith("session-1", "assistant-1", event);
    expect(ctx.tabsRef.current[0]).toMatchObject({ lastEventSeq: 7, status: "running" });
    sub.close();
    expect(ctx.close).toHaveBeenCalledOnce();
  });

  it("drains follow-up queue when a resumed runtime emits agent_end", () => {
    const ctx = harness([session({ queue: [{ id: "q1", mode: "follow_up", text: "next" }] })]);
    subscribeResumeRuntimeSession(ctx.deps);

    ctx.handlers?.onPayload({ type: "pi", seq: 8, event: { type: "agent_end" } });

    expect(ctx.tabsRef.current[0]).toMatchObject({ status: "idle", activeAssistantId: undefined });
    expect(ctx.submitPromptRef.current).toHaveBeenCalledWith({
      text: "next",
      prompt: "next",
      displayText: "next",
      userText: "next",
      targetSessionId: "session-1",
    });
  });

  it("marks dropped runtimes idle after a failed resume stream", async () => {
    const ctx = harness([session({ status: "starting", activeAssistantId: "assistant-1" })]);
    subscribeResumeRuntimeSession(ctx.deps);

    ctx.handlers?.onError();
    await Promise.resolve();

    expect(ctx.tabsRef.current[0]).toMatchObject({ status: "idle", activeAssistantId: undefined });
    expect(ctx.close).toHaveBeenCalledOnce();
  });
});
