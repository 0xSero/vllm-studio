import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { parseAgentTurnRequest } from "../../../shared/agent/agent-turn";
import {
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
    expect(planQueuedFollowUpMutation(["first", "old", "last"], "old", "replace", "new")).toEqual({
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
  expect(calls).toEqual(["steer:already steering", "steer:promote", "follow:first", "follow:last"]);
});

test("Pi native steer interrupts one active run without aborting it", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "local-studio-native-steer-"));
  const faux = fauxProvider({ provider: "local-studio-native-steer", tokensPerSecond: 20 });
  let secondTurnSawSteer = false;
  faux.setResponses([
    fauxAssistantMessage(
      "This deliberately long first response keeps the native Pi turn active for steering.",
    ),
    (context) => {
      secondTurnSawSteer = context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("steer now"),
      );
      return fauxAssistantMessage("Steering applied.");
    },
  ]);
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(directory, "auth.json"),
    modelsPath: null,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const { session } = await createAgentSession({
    agentDir: directory,
    cwd: directory,
    modelRuntime,
    model: faux.getModel(),
    noTools: "all",
    sessionManager: SessionManager.inMemory(directory),
  });
  const events: string[] = [];
  const unsubscribe = session.subscribe((event) => events.push(event.type));
  try {
    const active = session.prompt("start");
    while (!session.isStreaming) await new Promise((resolve) => setTimeout(resolve, 5));
    await session.steer("steer now");
    expect(session.getSteeringMessages()).toEqual(["steer now"]);
    await active;
    await session.waitForIdle();
    expect(secondTurnSawSteer).toBeTrue();
    expect(faux.state.callCount).toBe(2);
    expect(events.filter((event) => event === "agent_start")).toHaveLength(1);
    expect(events.filter((event) => event === "agent_end")).toHaveLength(1);
    expect(session.getSteeringMessages()).toEqual([]);
  } finally {
    unsubscribe();
    await session.dispose();
    rmSync(directory, { recursive: true });
  }
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
