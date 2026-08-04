import assert from "node:assert/strict";
import { test } from "node:test";
import {
  messagesToResumeAfterAbort,
  removePendingSteersClearedByAbort,
} from "./chat-pane-send-flow-model";

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
