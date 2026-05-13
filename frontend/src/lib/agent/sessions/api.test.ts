import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortSession,
  compactSession,
  loadCanonicalSession,
  loadRuntimeStatus,
  submitTurnStream,
  subscribeRuntimeEvents,
} from "./api";

function mockFetch(response: Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent sessions api clients", () => {
  it("loads runtime status with events and returns null on transport errors", async () => {
    const fetchMock = mockFetch(
      new Response(JSON.stringify({ status: { active: true, piSessionId: "pi-1" }, events: [] })),
    );

    await expect(loadRuntimeStatus("session 1")).resolves.toEqual({
      active: true,
      piSessionId: "pi-1",
      events: [],
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/runtime/status?sessionId=session%201", {
      cache: "no-store",
    });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(loadRuntimeStatus("session 1")).resolves.toBeNull();
  });

  it("loads canonical sessions and surfaces API errors", async () => {
    const fetchMock = mockFetch(new Response(JSON.stringify({ events: [{ type: "session" }] })));

    await expect(loadCanonicalSession("pi/1", "/tmp/project")).resolves.toEqual({
      events: [{ type: "session" }],
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/sessions/pi%2F1?cwd=%2Ftmp%2Fproject", {
      cache: "no-store",
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "missing" }), { status: 404 }),
    );
    await expect(loadCanonicalSession("missing", "/tmp/project")).rejects.toThrow("missing");
  });

  it("posts abort and compaction requests", async () => {
    const fetchMock = mockFetch(new Response(JSON.stringify({ status: { piSessionId: "pi-2" } })));

    await expect(abortSession("session-1")).resolves.toBeUndefined();
    await expect(
      compactSession({
        sessionId: "session-1",
        modelId: "model",
        browserToolEnabled: true,
        plugins: [],
        skills: [],
      }),
    ).resolves.toEqual({ status: { piSessionId: "pi-2" } });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/agent/abort",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/agent/compact",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "too large" }), { status: 413 }),
    );
    await expect(
      compactSession({
        sessionId: "session-1",
        modelId: "model",
        browserToolEnabled: false,
        plugins: [],
        skills: [],
      }),
    ).rejects.toThrow("too large");
  });

  it("streams valid turn SSE payloads and rejects missing response bodies", async () => {
    mockFetch(
      streamResponse([
        'data: {"type":"status","phase":"starting"}\n\n',
        'event: ignored\ndata: {"type":"pi","seq":1,"event":{"type":"message"}}\n\n',
        "data: not-json\n\n",
      ]),
    );
    const payloads: unknown[] = [];

    await submitTurnStream(
      {
        sessionId: "session-1",
        modelId: "model",
        message: "hello",
        browserToolEnabled: false,
        plugins: [],
        skills: [],
      },
      (payload) => payloads.push(payload),
    );

    expect(payloads).toEqual([
      { type: "status", phase: "starting" },
      { type: "pi", seq: 1, event: { type: "message" } },
    ]);

    mockFetch(new Response(JSON.stringify({ error: "bad request" }), { status: 400 }));
    await expect(
      submitTurnStream(
        {
          sessionId: "session-1",
          modelId: "model",
          message: "hello",
          browserToolEnabled: false,
          plugins: [],
          skills: [],
        },
        () => undefined,
      ),
    ).rejects.toThrow("bad request");
  });

  it("subscribes to runtime EventSource events and exposes close", () => {
    const instances: Array<{
      close: ReturnType<typeof vi.fn>;
      onmessage?: (event: MessageEvent) => void;
      onerror?: () => void;
      url: string;
    }> = [];
    class FakeEventSource {
      onmessage?: (event: MessageEvent) => void;
      onerror?: () => void;
      close = vi.fn();
      constructor(public url: string) {
        instances.push(this);
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const onPayload = vi.fn();
    const onError = vi.fn();

    const subscription = subscribeRuntimeEvents("session 1", 12, { onPayload, onError });
    instances[0]?.onmessage?.({ data: '{"type":"status","phase":"running"}' } as MessageEvent);
    instances[0]?.onmessage?.({ data: "not json" } as MessageEvent);
    instances[0]?.onerror?.();
    subscription.close();

    expect(instances[0]?.url).toBe("/api/agent/runtime/events?sessionId=session+1&after=12");
    expect(onPayload).toHaveBeenCalledWith({ type: "status", phase: "running" });
    expect(onError).toHaveBeenCalledOnce();
    expect(instances[0]?.close).toHaveBeenCalledOnce();
  });
});
