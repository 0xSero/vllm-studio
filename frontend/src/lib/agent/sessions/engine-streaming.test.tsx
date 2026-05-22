import React, { act, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnSsePayload } from "@/lib/agent/session";
import type { ToolSelection } from "@/lib/agent/tools/types";
import { useSessionEngine, type SessionEngine } from "./engine";
import type { SubmitTurnArgs } from "./api";
import type { Session } from "./types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const apiMocks = vi.hoisted(() => ({
  abortSession: vi.fn(),
  compactSession: vi.fn(),
  loadCanonicalSession: vi.fn(),
  loadRuntimeStatus: vi.fn(),
  submitTurnStream: vi.fn(),
  subscribeRuntimeEvents: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

type StreamCall = {
  args: SubmitTurnArgs;
  emit: (payload: AgentTurnSsePayload) => void;
  resolve: () => void;
};

const emptySelection: ToolSelection = { plugins: [], skills: [] };

function session(patch: Partial<Session> = {}): Session {
  return {
    id: "s1",
    runtimeSessionId: "runtime-1",
    piSessionId: null,
    title: "Session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
    ...patch,
  };
}

function textDelta(delta: string): Record<string, unknown> {
  return {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta },
  };
}

function renderEngine(initialTabs: Session[]) {
  let latestEngine: SessionEngine | null = null;
  let latestTabs = initialTabs;
  const host = document.createElement("div");
  const root = createRoot(host);

  const Probe = () => {
    const [tabs, setTabs] = useState(initialTabs);
    const engine = useSessionEngine({
      tabs,
      activeTabId: "s1",
      runtimeSessionId: "runtime-1",
      modelId: "model-1",
      cwd: "/tmp/project",
      browserToolEnabled: false,
      canvasEnabled: false,
      updateSession: (sessionId, patch) => {
        setTabs((current) =>
          current.map((entry) => (entry.id === sessionId ? patch(entry) : entry)),
        );
      },
      selectionFor: () => emptySelection,
    });

    useLayoutEffect(() => {
      latestEngine = engine;
      latestTabs = tabs;
    }, [engine, tabs]);

    return null;
  };

  act(() => {
    root.render(React.createElement(Probe));
  });

  return {
    get engine() {
      if (!latestEngine) throw new Error("engine did not render");
      return latestEngine;
    },
    get tabs() {
      return latestTabs;
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

async function startPrompt(engine: SessionEngine) {
  await act(async () => {
    void engine.submitPrompt({
      text: "hello",
      prompt: "hello",
      displayText: "hello",
      userText: "hello",
    });
    await Promise.resolve();
  });
}

async function emit(call: StreamCall, payload: AgentTurnSsePayload) {
  await act(async () => {
    call.emit(payload);
    await Promise.resolve();
  });
}

async function runFrame(frames: FrameRequestCallback[]) {
  await act(async () => {
    const callbacks = frames.splice(0);
    for (const callback of callbacks) callback(performance.now());
    await Promise.resolve();
  });
}

describe("useSessionEngine streaming", () => {
  let streams: StreamCall[];
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    streams = [];
    frames = [];
    apiMocks.loadRuntimeStatus.mockResolvedValue(null);
    apiMocks.submitTurnStream.mockImplementation(
      (args: SubmitTurnArgs, emitPayload: (payload: AgentTurnSsePayload) => void) => {
        let resolve!: () => void;
        const promise = new Promise<void>((resolvePromise) => {
          resolve = resolvePromise;
        });
        streams.push({ args, emit: emitPayload, resolve });
        return promise;
      },
    );
    apiMocks.subscribeRuntimeEvents.mockReturnValue({ close: vi.fn() });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("coalesces 100 text deltas into one assistant block after one animation frame", async () => {
    const harness = renderEngine([session()]);
    await startPrompt(harness.engine);

    const call = streams[0];
    expect(call).toBeDefined();

    for (let index = 0; index < 100; index += 1) {
      call.emit({ type: "pi", event: textDelta("x") });
    }
    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.tabs[0].messages.at(-1)?.blocks).toEqual([]);
    expect(frames).toHaveLength(1);

    await runFrame(frames);

    expect(harness.tabs[0].messages.at(-1)?.blocks).toMatchObject([
      { kind: "text", text: "x".repeat(100) },
    ]);

    harness.unmount();
  });

  it("flushes pending text synchronously when agent_end arrives", async () => {
    const harness = renderEngine([session()]);
    await startPrompt(harness.engine);

    const call = streams[0];
    await emit(call, { type: "pi", event: textDelta("tail") });
    expect(harness.tabs[0].messages.at(-1)?.blocks).toEqual([]);

    await emit(call, { type: "pi", event: { type: "agent_end" } });

    expect(harness.tabs[0].messages[0]).toMatchObject({ role: "user", text: "hello" });
    expect(harness.tabs[0].messages.at(-1)?.blocks).toMatchObject([{ kind: "text", text: "tail" }]);

    harness.unmount();
  });

  it("flushes before a queued follow-up echo and still removes the delivered queue item", async () => {
    const harness = renderEngine([
      session({ queue: [{ id: "q1", mode: "follow_up", text: "queued next", sent: true }] }),
    ]);
    await startPrompt(harness.engine);

    const call = streams[0];
    await emit(call, { type: "pi", event: textDelta("before queue") });
    await emit(call, {
      type: "pi",
      event: { type: "message_start", message: { role: "user", content: "queued next" } },
    });

    const current = harness.tabs[0];
    expect(current.queue).toEqual([]);
    expect(
      current.messages.some((message) => message.role === "user" && message.text === "hello"),
    ).toBe(true);
    expect(
      current.messages.some((message) => message.role === "user" && message.text === "queued next"),
    ).toBe(true);
    expect(current.messages.find((message) => message.role === "assistant")?.blocks).toMatchObject([
      { kind: "text", text: "before queue" },
    ]);

    harness.unmount();
  });
});
