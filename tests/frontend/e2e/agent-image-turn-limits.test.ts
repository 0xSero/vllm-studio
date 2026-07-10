import assert from "node:assert/strict";
import test from "node:test";
import { handleAgentTurn } from "@local-studio/agent-runtime/http/handlers";
import { AGENT_IMAGE_LIMITS, type AgentImageInput } from "@shared/agent/agent-image-input";
import { AGENT_TURN_BODY_LIMIT_BYTES } from "@shared/agent/agent-turn-body";

function base64WithBytes(bytes: number) {
  return Buffer.alloc(bytes).toString("base64");
}

function image(data: string): AgentImageInput {
  return { type: "image", data, mimeType: "image/png" };
}

function turnRequest(images: ReturnType<typeof image>[], message = "Inspect the images") {
  return new Request("http://localhost/api/agent/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "image-limit-test",
      modelId: "vision-model",
      message,
      images,
    }),
  });
}

async function responseError(response: Response) {
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") return undefined;
  const error = Reflect.get(payload, "error");
  return typeof error === "string" ? error : undefined;
}

test("the direct agent turn endpoint rejects more than four images", async () => {
  const data = base64WithBytes(1);
  const response = await handleAgentTurn(
    turnRequest(Array.from({ length: AGENT_IMAGE_LIMITS.count + 1 }, () => image(data))),
  );

  assert.equal(response.status, 400);
  assert.equal(await responseError(response), "Attach up to 4 images per message.");
});

test("the direct agent turn endpoint rejects image payloads above the aggregate limit", async () => {
  const atPerImageLimit = base64WithBytes(AGENT_IMAGE_LIMITS.perImageBytes);
  const response = await handleAgentTurn(
    turnRequest([image(atPerImageLimit), image(atPerImageLimit), image(base64WithBytes(1))]),
  );

  assert.equal(response.status, 400);
  assert.equal(await responseError(response), "Inline images can total up to 12 MB per message.");
});

test("the direct agent turn endpoint caps actual request bytes before JSON parsing", async () => {
  const response = await handleAgentTurn(turnRequest([], "x".repeat(AGENT_TURN_BODY_LIMIT_BYTES)));

  assert.equal(response.status, 413);
  assert.equal(
    await responseError(response),
    `Request body exceeds the ${Math.floor(AGENT_TURN_BODY_LIMIT_BYTES / 1_000_000)} MB agent turn limit.`,
  );
});
