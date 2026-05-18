import { describe, expect, it, vi } from "vitest";
import { drainQueuedTurnAfterAgentEnd } from "./queue-drain";
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
  const tabsRef = { current: initial };
  const submitPromptRef = { current: vi.fn(async () => undefined) };
  const updateSession = vi.fn((sessionId: string, patch: (session: Session) => Session) => {
    tabsRef.current = tabsRef.current.map((entry) =>
      entry.id === sessionId ? patch(entry) : entry,
    );
  });
  const schedule = vi.fn((callback: () => void) => callback());
  return { schedule, submitPromptRef, tabsRef, updateSession };
}

describe("session queue drain", () => {
  it("submits the next follow-up behind a narrow queue Interface", () => {
    const deps = harness([
      session({
        queue: [
          { id: "steer", mode: "steer", text: "interrupt" },
          { id: "next", mode: "follow_up", text: "continue" },
          { id: "later", mode: "follow_up", text: "then summarize" },
        ],
      }),
    ]);

    drainQueuedTurnAfterAgentEnd(deps, "session-1");

    expect(deps.tabsRef.current[0].queue).toEqual([
      { id: "later", mode: "follow_up", text: "then summarize" },
    ]);
    expect(deps.schedule).toHaveBeenCalledOnce();
    expect(deps.submitPromptRef.current).toHaveBeenCalledWith({
      text: "continue",
      prompt: "continue",
      displayText: "continue",
      userText: "continue",
      targetSessionId: "session-1",
    });
  });

  it("clears non-drainable queued work without scheduling a turn", () => {
    const deps = harness([
      session({
        queue: [
          { id: "steer", mode: "steer", text: "interrupt", sent: true },
          { id: "accepted-follow", mode: "follow_up", text: "already accepted", sent: true },
        ],
      }),
    ]);

    drainQueuedTurnAfterAgentEnd(deps, "session-1");

    expect(deps.tabsRef.current[0].queue).toEqual([]);
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.submitPromptRef.current).not.toHaveBeenCalled();
  });
});
