import { describe, expect, it, vi } from "vitest";
import { createSessionBatcher } from "./session-batcher";
import type { Session } from "./types";

const baseSession = (overrides: Partial<Session> = {}): Session => ({
  id: "s1",
  runtimeSessionId: "rt",
  piSessionId: null,
  title: "Session",
  messages: [],
  status: "idle",
  error: "",
  input: "",
  ...overrides,
});

describe("createSessionBatcher", () => {
  it("composes multiple patches for the target session into one update call", () => {
    const sessions = new Map<string, Session>([["s1", baseSession()]]);
    const real = vi.fn((sessionId: string, patch: (s: Session) => Session) => {
      const current = sessions.get(sessionId);
      if (current) sessions.set(sessionId, patch(current));
    });

    const batcher = createSessionBatcher(real);
    batcher.run("s1", (update) => {
      update("s1", (s) => ({ ...s, status: "starting" }));
      update("s1", (s) => ({ ...s, error: "hi" }));
      update("s1", (s) => ({ ...s, title: "renamed" }));
    });

    expect(real).toHaveBeenCalledTimes(1);
    expect(sessions.get("s1")).toMatchObject({
      status: "starting",
      error: "hi",
      title: "renamed",
    });
  });

  it("forwards updates for other session ids straight through", () => {
    const sessions = new Map<string, Session>([
      ["s1", baseSession({ id: "s1" })],
      ["s2", baseSession({ id: "s2" })],
    ]);
    const real = vi.fn((sessionId: string, patch: (s: Session) => Session) => {
      const current = sessions.get(sessionId);
      if (current) sessions.set(sessionId, patch(current));
    });

    const batcher = createSessionBatcher(real);
    batcher.run("s1", (update) => {
      update("s1", (s) => ({ ...s, status: "running" }));
      update("s2", (s) => ({ ...s, status: "running" }));
      update("s1", (s) => ({ ...s, error: "ok" }));
    });

    // 1 forwarded call for s2 + 1 composed call for s1
    expect(real).toHaveBeenCalledTimes(2);
    expect(sessions.get("s1")?.status).toBe("running");
    expect(sessions.get("s1")?.error).toBe("ok");
    expect(sessions.get("s2")?.status).toBe("running");
  });

  it("does not invoke the real updater when no patches were queued", () => {
    const real = vi.fn();
    const batcher = createSessionBatcher(real);
    batcher.run("s1", () => {
      // intentionally empty
    });
    expect(real).not.toHaveBeenCalled();
  });

  it("preserves patch order (later patches see earlier mutations)", () => {
    const sessions = new Map<string, Session>([["s1", baseSession({ status: "idle" })]]);
    const real = vi.fn((sessionId: string, patch: (s: Session) => Session) => {
      const current = sessions.get(sessionId);
      if (current) sessions.set(sessionId, patch(current));
    });

    const batcher = createSessionBatcher(real);
    batcher.run("s1", (update) => {
      update("s1", (s) => ({ ...s, status: "starting" }));
      update("s1", (s) =>
        s.status === "starting" ? { ...s, status: "running", error: "saw starting" } : s,
      );
    });

    expect(sessions.get("s1")?.status).toBe("running");
    expect(sessions.get("s1")?.error).toBe("saw starting");
  });
});
