import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserContextUrlForSession,
  messagesToResumeAfterAbort,
  removePendingSteersClearedByAbort,
} from "./chat-pane-send-flow-model";

function storage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("browser context reads the target session instead of the focused session", () => {
  const target = storage();
  target.setItem(
    "local-studio.agent.sessionViewState.v1",
    JSON.stringify({
      version: 1,
      views: {
        "session-b": {
          scrollTop: 0,
          stickToBottom: true,
          browser: { input: "https://b.example", url: "https://b.example" },
        },
      },
    }),
  );
  const browser = {
    enabled: true,
    backend: "embedded" as const,
    sessionId: "session-a",
    input: "https://a.example",
    url: "https://a.example",
  };
  assert.equal(browserContextUrlForSession(browser, "session-a", target), "https://a.example");
  assert.equal(browserContextUrlForSession(browser, "session-b", target), "https://b.example");
  assert.equal(browserContextUrlForSession(browser, "session-c", target), "about:blank");
});

test("stop resumes the visible queue without duplicating the runtime copy", () => {
  assert.deepEqual(
    messagesToResumeAfterAbort(
      [{ id: "queue-1", mode: "follow_up", text: "send this next", sent: true }],
      { steering: [], followUp: ["send this next"] },
    ),
    ["send this next"],
  );
});

test("stop recovers runtime-only steering and follow-ups in delivery order", () => {
  assert.deepEqual(
    messagesToResumeAfterAbort([], {
      steering: ["steer now"],
      followUp: ["<browser_context>\ninternal\n</browser_context>\n\nfollow up after stop"],
    }),
    ["steer now", "follow up after stop"],
  );
});

test("stop replaces an undelivered optimistic steer instead of duplicating it", () => {
  assert.deepEqual(
    removePendingSteersClearedByAbort(
      [
        { id: "user-1", role: "user", text: "already delivered" },
        {
          id: "user-2",
          role: "user",
          text: "steer now",
          pending: true,
          awaitingEcho: true,
        },
      ],
      { steering: ["steer now"], followUp: [] },
    ).map((message) => message.id),
    ["user-1"],
  );
});
