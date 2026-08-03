import { describe, expect, test } from "bun:test";
import { parseAgentTurnRequest } from "../../../shared/agent/agent-turn";
import {
  interruptWithPrompt,
  planQueuedFollowUpMutation,
  restoreQueuedMessages,
  takeQueuedFollowUp,
} from "../src/pi-runtime";

describe("takeQueuedFollowUp", () => {
  test("removes one exact queued message and preserves order", () => {
    expect(takeQueuedFollowUp(["first", "promote", "last"], "promote")).toEqual({
      selected: "promote",
      before: ["first"],
      after: ["last"],
    });
  });

  test("matches the visible prompt when composer context changed", () => {
    const queued = "Composer context:\n$old\n\nUser prompt:\npromote";
    const current = "Composer context:\n$new\n\nUser prompt:\npromote";
    expect(takeQueuedFollowUp([queued, "last"], current)).toEqual({
      selected: queued,
      before: [],
      after: ["last"],
    });
  });

  test("removes only the first duplicate", () => {
    expect(takeQueuedFollowUp(["same", "same"], "same")).toEqual({
      selected: "same",
      before: [],
      after: ["same"],
    });
  });

  test("returns null when the runtime queue no longer has the message", () => {
    expect(takeQueuedFollowUp(["other"], "missing")).toBeNull();
  });
});

describe("planQueuedFollowUpMutation", () => {
  test("promotes one message and leaves the remaining follow-ups", () => {
    expect(planQueuedFollowUpMutation(["first", "now", "last"], "now", "promote")).toEqual({
      promoted: "now",
      followUp: ["first", "last"],
    });
  });

  test("removes one message from the runtime queue", () => {
    expect(planQueuedFollowUpMutation(["first", "remove", "last"], "remove", "remove")).toEqual({
      promoted: null,
      followUp: ["first", "last"],
    });
  });

  test("replaces in place without changing queue order", () => {
    expect(
      planQueuedFollowUpMutation(["first", "old", "last"], "old", "replace", "new"),
    ).toEqual({
      promoted: null,
      followUp: ["first", "new", "last"],
    });
  });
});

test("restores queued messages in delivery order", async () => {
  const calls: string[] = [];
  await restoreQueuedMessages(
    {
      steer: async (message) => void calls.push(`steer:${message}`),
      followUp: async (message) => void calls.push(`follow:${message}`),
    },
    { steering: ["already steering"], followUp: ["first", "promote", "last"] },
    { promoted: "promote", followUp: ["first", "last"] },
  );
  expect(calls).toEqual([
    "steer:already steering",
    "steer:promote",
    "follow:first",
    "follow:last",
  ]);
});

test("interrupts before launching the steered prompt and restores the queue", async () => {
  const calls: string[] = [];
  await interruptWithPrompt(
    {
      abort: async () => void calls.push("abort"),
      waitForIdle: async () => void calls.push("idle"),
      steer: async (message) => void calls.push(`steer:${message}`),
      followUp: async (message) => void calls.push(`follow:${message}`),
    },
    { steering: ["already steering"], followUp: ["first", "last"] },
    () => void calls.push("prompt:promoted"),
  );
  expect(calls).toEqual([
    "abort",
    "idle",
    "prompt:promoted",
    "steer:already steering",
    "follow:first",
    "follow:last",
  ]);
});

describe("queued action contract", () => {
  test("parses queue removal commands", () => {
    const result = parseAgentTurnRequest({
      message: "remove",
      modelId: "model",
      mode: "follow_up",
      queueAction: "remove",
    });
    expect(result.ok).toBeTrue();
    if (result.ok) expect(result.value.queueAction).toBe("remove");
  });

  test("requires replacement text for queue edits", () => {
    const result = parseAgentTurnRequest({
      message: "old",
      modelId: "model",
      mode: "follow_up",
      queueAction: "replace",
    });
    expect(result).toEqual({
      ok: false,
      error: "queueReplacement is required when replacing a queued message",
    });
  });
});
