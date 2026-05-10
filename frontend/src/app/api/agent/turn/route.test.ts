import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";
import { POST } from "./route";

vi.mock("@/lib/agent/pi-runtime", () => ({
  piRuntimeManager: {
    getSession: vi.fn(),
  },
}));

vi.mock("@/lib/agent/sessions-store", () => ({
  listSessions: vi.fn().mockResolvedValue([]),
}));

const getSession = vi.mocked(piRuntimeManager.getSession);

describe("POST /api/agent/turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts prompt turns with only active sanitized plugin and skill selections", async () => {
    const session = {
      ensureStarted: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockImplementation(async (_message, onEvent) => {
        onEvent({ type: "agent_end" }, 1);
      }),
      status: { piSessionId: "pi-1", cwd: "/repo", active: false, running: true },
      adoptPiSessionId: vi.fn(),
    };
    getSession.mockReturnValue(session as never);

    const response = await POST(
      new NextRequest("http://localhost/api/agent/turn", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "tab-1",
          modelId: "hy3-preview",
          message: "inspect localhost",
          cwd: "/repo",
          piSessionId: "pi-1",
          plugins: [
            { id: "browser", name: "browser-use", enabled: true, skillPath: "/browser/skills" },
            { id: "computer", name: "computer-use", enabled: false, skillPath: "/nope" },
          ],
          skills: [{ id: "agent", name: "agent-browser", path: "/skills/agent-browser" }],
        }),
      }),
    );

    await response.text();
    const startOptions = session.ensureStarted.mock.calls[0]?.[3];
    expect(session.ensureStarted).toHaveBeenCalledWith(
      "hy3-preview",
      "/repo",
      "pi-1",
      expect.any(Object),
    );
    expect(startOptions).toMatchObject({
      browserToolEnabled: false,
      plugins: [
        { id: "browser", name: "browser-use", enabled: true, skillPath: "/browser/skills" },
      ],
      skills: [{ id: "agent", name: "agent-browser", path: "/skills/agent-browser" }],
    });
    expect(startOptions.plugins).toHaveLength(1);
    expect(session.prompt).toHaveBeenCalledWith("inspect localhost", expect.any(Function), {
      streamingBehavior: undefined,
    });
  });

  it("prompts instead of queueing control messages when the runtime is not active", async () => {
    const session = {
      ensureStarted: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockImplementation(async (_message, onEvent) => {
        onEvent(
          { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ok" } },
          1,
        );
        onEvent({ type: "agent_end" }, 2);
      }),
      steer: vi.fn(),
      followUp: vi.fn(),
      status: { piSessionId: "pi-1", cwd: "/repo", active: false, running: true },
      adoptPiSessionId: vi.fn(),
    };
    getSession.mockReturnValue(session as never);

    const response = await POST(
      new NextRequest("http://localhost/api/agent/turn", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "tab-1",
          modelId: "hy3-preview",
          message: "continue",
          cwd: "/repo",
          piSessionId: "pi-1",
          mode: "steer",
        }),
      }),
    );

    const body = await response.text();
    expect(session.ensureStarted).toHaveBeenCalled();
    expect(session.prompt).toHaveBeenCalledWith("continue", expect.any(Function), {
      streamingBehavior: undefined,
    });
    expect(session.steer).not.toHaveBeenCalled();
    expect(session.followUp).not.toHaveBeenCalled();
    expect(body).toContain('"type":"pi"');
    expect(body).toContain('"delta":"ok"');
  });
});
