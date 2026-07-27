import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_STREAM_REPLAY_CHARS,
  appendStreamReplay,
  parseSseFrames,
} from "./web-pty-bridge";

// The client mirrors the server's bounded scrollback so a reattach that reuses
// a still-live stream (second pane, or a fresh xterm boot racing teardown) can
// be handed the same buffer instead of rendering blank — the reuse path never
// receives its own `snapshot` frame. See issue #287.
test("appendStreamReplay concatenates live chunks", () => {
  let buf = "";
  buf = appendStreamReplay(buf, "hello ");
  buf = appendStreamReplay(buf, "world");
  assert.equal(buf, "hello world");
});

test("appendStreamReplay bounds the buffer and keeps the tail", () => {
  const big = "A".repeat(MAX_STREAM_REPLAY_CHARS);
  const bounded = appendStreamReplay(big, "TAIL");
  assert.equal(bounded.length, MAX_STREAM_REPLAY_CHARS);
  assert.ok(bounded.endsWith("TAIL"));
  // The oldest output rolled off the front.
  assert.ok(!bounded.startsWith(big));

  const exact = appendStreamReplay("", "X".repeat(MAX_STREAM_REPLAY_CHARS));
  assert.equal(exact.length, MAX_STREAM_REPLAY_CHARS);
});

test("parseSseFrames splits complete frames and returns the trailing remainder", () => {
  const { frames, rest } = parseSseFrames(
    "event: snapshot\ndata: c25hcA==\n\ndata: bGl2ZQ==\n\ndata: partia",
  );
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], { event: "snapshot", data: "c25hcA==" });
  assert.deepEqual(frames[1], { event: "message", data: "bGl2ZQ==" });
  assert.equal(rest, "data: partia");
});

test("parseSseFrames surfaces exit and gone events with their JSON payload", () => {
  const { frames } = parseSseFrames('event: exit\ndata: {"exitCode":0,"signal":null}\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "exit");
  assert.deepEqual(JSON.parse(frames[0].data), { exitCode: 0, signal: null });
});

test("parseSseFrames ignores keep-alive ping comments", () => {
  // `: ping` comment lines carry neither an event: nor a data: field.
  const { frames, rest } = parseSseFrames(": ping\n\ndata: aGk=\n\n");
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], { event: "message", data: "aGk=" });
  assert.equal(rest, "");
});
