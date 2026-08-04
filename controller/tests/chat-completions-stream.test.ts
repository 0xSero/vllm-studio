import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { Effect } from "effect";
import { buildChatCompletionsStreamResponse } from "../src/modules/proxy/chat-completions-stream";

const encoder = new TextEncoder();
const servers: Server<undefined>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("chat completions streaming proxy", () => {
  test("keeps the upstream response body alive after fetch resolves", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(encoder.encode(": upstream\n\n"));
              await Bun.sleep(25);
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"index":0,"delta":{"content":"READY"}}]}\n\n',
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    servers.push(server);

    const response = buildChatCompletionsStreamResponse({
      upstreamUrl: `${server.url}v1/chat/completions`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: true }),
      clientSignal: new AbortController().signal,
      matchedRecipe: null,
      sourceHeader: "test",
      sessionId: null,
      recordedModel: "test-model",
      recordedProvider: "local",
      requestStart: performance.now(),
      requestProvider: "local-studio",
      providerRouting: null,
      context: {
        logger: {
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          shutdown: () => Effect.void,
        },
        stores: {} as never,
      },
      keepaliveIntervalMs: 1_000,
    });

    expect(await response.text()).toContain('"content":"READY"');
  });
});
