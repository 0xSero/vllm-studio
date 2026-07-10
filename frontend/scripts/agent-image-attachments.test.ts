import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Effect } from "effect";
import { AgentAttachmentTray } from "@/features/agent/ui/agent-attachment-tray";
import { createAttachmentQueue } from "@/features/agent/ui/chat-pane-composer-attachments";
import {
  appendAttachmentsWithinImageLimits,
  inlineImageAttachmentStats,
  preflightAttachmentFiles,
  type ChatAttachment,
} from "@/features/agent/ui/chat-attachments";
import {
  AGENT_IMAGE_MAX_BASE64_CHARS,
  AGENT_IMAGE_LIMITS,
  agentImageByteLength,
  agentImageLimitError,
} from "@shared/agent/agent-image-input";
import { parseAgentTurnRequest } from "@shared/agent/agent-turn";

function base64WithBytes(bytes: number) {
  return Buffer.alloc(bytes).toString("base64");
}

function imageAttachment(id: string, bytes: number): ChatAttachment {
  const data = base64WithBytes(bytes);
  return {
    id,
    name: `${id}.png`,
    type: "image/png",
    size: bytes,
    mode: "data-url",
    content: `data:image/png;base64,${data}`,
    previewKind: "image",
  };
}

test("image attachment limits accept four images and reject the fifth", () => {
  const result = appendAttachmentsWithinImageLimits(
    [],
    Array.from({ length: 5 }, (_, index) => imageAttachment(`image-${index}`, 1)),
  );

  assert.equal(result.attachments.length, AGENT_IMAGE_LIMITS.count);
  assert.equal(result.discarded.length, 1);
  assert.equal(result.error, "Attach up to 4 images per message.");
});

test("image file preflight rejects excess images before reading them", async () => {
  const files = Array.from(
    { length: AGENT_IMAGE_LIMITS.count + 1 },
    (_, index) => new File([new Uint8Array([index])], `image-${index}.png`, { type: "image/png" }),
  );
  const preflight = preflightAttachmentFiles([], files);
  const readNames: string[] = [];
  await Promise.all(
    preflight.accepted.map(async (file) => {
      readNames.push(file.name);
    }),
  );

  assert.equal(preflight.accepted.length, AGENT_IMAGE_LIMITS.count);
  assert.equal(preflight.discarded.length, 1);
  assert.equal(preflight.error, "Attach up to 4 images per message.");
  assert.doesNotMatch(readNames.join(" "), /image-4\.png/);
});

test("attachment batches queue instead of dropping overlapping input", async () => {
  const queue = createAttachmentQueue();
  const order: string[] = [];
  let startFirst: () => void = () => undefined;
  let releaseFirst: () => void = () => undefined;
  const firstStarted = new Promise<void>((resolve) => {
    startFirst = resolve;
  });
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = Effect.runPromise(
    queue.withPermit(
      Effect.gen(function* () {
        order.push("first:start");
        startFirst();
        yield* Effect.promise(() => firstGate);
        order.push("first:end");
      }),
    ),
  );
  await firstStarted;
  const second = Effect.runPromise(
    queue.withPermit(
      Effect.sync(() => {
        order.push("second");
      }),
    ),
  );
  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("image attachment limits discard duplicate files without consuming a slot", () => {
  const original = imageAttachment("same", 1);
  const duplicate = { ...original, id: "duplicate" };
  const result = appendAttachmentsWithinImageLimits([original], [duplicate]);

  assert.equal(result.attachments.length, 1);
  assert.equal(result.discarded.length, 1);
  assert.equal(result.error, null);
});

test("the attachment tray warns before sending images to a text-only model", () => {
  const attachment = imageAttachment("preview", 1);
  const textOnly = renderToStaticMarkup(
    createElement(AgentAttachmentTray, {
      attachments: [attachment],
      modelSupportsVision: false,
      onRemove: () => undefined,
    }),
  );
  const vision = renderToStaticMarkup(
    createElement(AgentAttachmentTray, {
      attachments: [attachment],
      modelSupportsVision: true,
      onRemove: () => undefined,
    }),
  );

  assert.match(textOnly, /Vision unavailable/);
  assert.match(textOnly, /The model will receive file details, not the image/);
  assert.doesNotMatch(vision, /Vision unavailable/);
});

test("image attachment limits enforce the aggregate decoded-byte boundary", () => {
  const atLimit = [
    imageAttachment("first", AGENT_IMAGE_LIMITS.perImageBytes),
    imageAttachment("second", AGENT_IMAGE_LIMITS.perImageBytes),
  ];
  const result = appendAttachmentsWithinImageLimits(atLimit, [imageAttachment("third", 1)]);
  const stats = inlineImageAttachmentStats(result.attachments);

  assert.equal(stats.count, 2);
  assert.equal(stats.bytes, AGENT_IMAGE_LIMITS.totalBytes);
  assert.equal(result.discarded.length, 1);
  assert.equal(result.error, "Inline images can total up to 12 MB per message.");
});

test("image input validation preserves the six megabyte per-image boundary", () => {
  const atLimit = base64WithBytes(AGENT_IMAGE_LIMITS.perImageBytes);
  const aboveLimit = base64WithBytes(AGENT_IMAGE_LIMITS.perImageBytes + 1);

  assert.equal(agentImageByteLength(atLimit), AGENT_IMAGE_LIMITS.perImageBytes);
  assert.equal(
    agentImageLimitError([{ type: "image", data: atLimit, mimeType: "image/png" }]),
    null,
  );
  assert.equal(
    agentImageLimitError([{ type: "image", data: aboveLimit, mimeType: "image/png" }]),
    "Each inline image must be 6 MB or smaller.",
  );
});

test("the agent turn parser rejects image counts before runtime dispatch", () => {
  const data = base64WithBytes(1);
  const parsed = parseAgentTurnRequest({
    sessionId: "image-limit-test",
    modelId: "vision-model",
    message: "Inspect the images",
    images: Array.from({ length: AGENT_IMAGE_LIMITS.count + 1 }, () => ({
      type: "image",
      data,
      mimeType: "image/png",
    })),
  });

  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error, "Attach up to 4 images per message.");
});

test("the agent turn parser rejects invalid and oversized base64 before normalization", () => {
  const request = (data: string) =>
    parseAgentTurnRequest({
      sessionId: "image-validation-test",
      modelId: "vision-model",
      message: "Inspect the image",
      images: [{ type: "image", data, mimeType: "image/png" }],
    });

  assert.deepEqual(request("not*base64"), {
    ok: false,
    error: "Image data must be valid base64.",
  });
  assert.deepEqual(request("A".repeat(AGENT_IMAGE_MAX_BASE64_CHARS + 4)), {
    ok: false,
    error: "Each inline image must be 6 MB or smaller.",
  });
});
