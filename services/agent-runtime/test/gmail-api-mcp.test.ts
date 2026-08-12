import { describe, expect, test } from "bun:test";
import { connectGmailApi, verifyGmailApiAccess } from "../src/gmail-api-mcp";

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("gmail api connector", () => {
  test("declares only the read-only Gmail tools", async () => {
    const connection = connectGmailApi(async () => ({ Authorization: "Bearer token" }));
    const tools = await connection.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "list_drafts",
      "get_thread",
      "get_message",
      "search_threads",
      "list_labels",
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  test("maps Gmail labels into the plugin tool result", async () => {
    const connection = connectGmailApi(
      async () => ({ Authorization: "Bearer token" }),
      undefined,
      async () =>
        jsonResponse({
          labels: [
            {
              id: "INBOX",
              name: "INBOX",
              messagesTotal: 12,
              messagesUnread: 3,
              threadsTotal: 8,
              threadsUnread: 2,
            },
          ],
        }),
    );

    const result = (await connection.callTool("list_labels", {})) as {
      structuredContent: { labels: Array<Record<string, unknown>> };
    };

    expect(result.structuredContent.labels).toEqual([
      {
        labelId: "INBOX",
        name: "INBOX",
        messagesTotal: 12,
        messagesUnread: 3,
        threadsTotal: 8,
        threadsUnread: 2,
      },
    ]);
  });

  test("refreshes authorization once after a 401", async () => {
    const refreshes: boolean[] = [];
    let requests = 0;
    const connection = connectGmailApi(
      async (forceRefresh) => {
        refreshes.push(forceRefresh);
        return { Authorization: forceRefresh ? "Bearer fresh" : "Bearer stale" };
      },
      undefined,
      async (_input, init) => {
        requests += 1;
        const authorization = new Headers(init?.headers).get("authorization");
        return authorization === "Bearer fresh"
          ? jsonResponse({ labels: [] })
          : jsonResponse({ error: "expired" }, 401);
      },
    );

    await connection.callTool("list_labels", {});

    expect(requests).toBe(2);
    expect(refreshes).toEqual([false, true]);
  });

  test("decodes message text and metadata", async () => {
    const connection = connectGmailApi(
      async () => ({ Authorization: "Bearer token" }),
      undefined,
      async () =>
        jsonResponse({
          id: "message-1",
          threadId: "thread-1",
          internalDate: "1786480000000",
          labelIds: ["INBOX", "UNREAD"],
          snippet: "Hello",
          payload: {
            mimeType: "multipart/alternative",
            headers: [
              { name: "From", value: "Alice <alice@example.com>" },
              { name: "To", value: "Sero <sherifcherfa@gmail.com>" },
              { name: "Subject", value: "Status" },
              { name: "Date", value: "Tue, 11 Aug 2026 12:00:00 +0000" },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: Buffer.from("Hello from Gmail").toString("base64url") },
              },
            ],
          },
        }),
    );

    const result = (await connection.callTool("get_message", {
      messageId: "message-1",
      messageFormat: "PLAIN_TEXT",
    })) as { structuredContent: Record<string, unknown> };

    expect(result.structuredContent).toMatchObject({
      id: "message-1",
      threadId: "thread-1",
      subject: "Status",
      sender: "Alice <alice@example.com>",
      plaintextBody: "Hello from Gmail",
      date: "2026-08-11",
    });
  });

  test("does not reconstruct markup from encoded HTML", async () => {
    const connection = connectGmailApi(
      async () => ({ Authorization: "Bearer token" }),
      undefined,
      async () =>
        jsonResponse({
          id: "message-1",
          payload: {
            mimeType: "text/html",
            body: {
              data: Buffer.from(
                "<p>Hello&nbsp;there</p><script>ignored()</script>&lt;script&gt;encoded()&lt;/script&gt;&amp;lt;script&amp;gt;double()",
              ).toString("base64url"),
            },
          },
        }),
    );

    const result = (await connection.callTool("get_message", {
      messageId: "message-1",
      messageFormat: "PLAIN_TEXT",
    })) as { structuredContent: { plaintextBody: string } };

    expect(result.structuredContent.plaintextBody).toBe(
      "Hello there\nignored()&lt;script&gt;encoded()&lt;/script&gt;&amp;lt;script&amp;gt;double()",
    );
  });

  test("verifies the same stable Gmail API used by the connector", async () => {
    let authorization = "";

    await verifyGmailApiAccess("access-token", AbortSignal.timeout(1_000), async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return jsonResponse({ labels: [] });
    });

    expect(authorization).toBe("Bearer access-token");
  });
});
