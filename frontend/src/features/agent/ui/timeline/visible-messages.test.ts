import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  mergeConsecutiveAssistantMessages,
  messageRenders,
  type MergedRun,
} from "./visible-messages";
import type { ChatMessage } from "@/features/agent/messages";

const user = (id: string, text: string): ChatMessage => ({ id, role: "user", text }) as ChatMessage;

const assistant = (id: string, text: string): ChatMessage =>
  ({
    id,
    role: "assistant",
    text,
    blocks: [{ kind: "text", id: `${id}-b`, text }],
  }) as unknown as ChatMessage;

/** A transcript of `turns` turns, each an assistant run split into 3 segments. */
function transcript(turns: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    messages.push(user(`u${turn}`, `ask ${turn}`));
    for (let segment = 0; segment < 3; segment += 1) {
      messages.push(assistant(`a${turn}-${segment}`, `answer ${turn}.${segment}`));
    }
  }
  return messages;
}

describe("visible message derivation", () => {
  test("stitches a turn's assistant segments into one bubble", () => {
    const cache = new Map<string, MergedRun>();

    const merged = mergeConsecutiveAssistantMessages(transcript(2).filter(messageRenders), cache);

    assert.deepEqual(
      merged.map((message) => message.role),
      ["user", "assistant", "user", "assistant"],
    );
    assert.equal(merged[1].text, "answer 0.0\nanswer 0.1\nanswer 0.2");
    // The merged id anchors on the first segment: a growing id would change the
    // React key on every tool boundary and remount the bubble mid-stream.
    assert.equal(merged[1].id, "a0-0");
  });

  test("drops messages that would render nothing", () => {
    const cache = new Map<string, MergedRun>();
    const messages = [
      user("u0", "   "),
      { id: "sys", role: "system", text: "hidden" } as ChatMessage,
      user("u1", "real question"),
      assistant("a1", "real answer"),
    ];

    const merged = mergeConsecutiveAssistantMessages(messages.filter(messageRenders), cache);

    assert.deepEqual(
      merged.map((message) => message.id),
      ["u1", "a1"],
    );
  });
});

// The regression this file exists for.
//
// The merge cache keeps a settled turn's object identity stable across frames.
// It used to be capped at 512 entries and cleared wholesale when full, which
// inverted its purpose on any conversation with more runs than the cap: every
// frame missed on entries it had just evicted, so every settled turn got a
// fresh identity and React re-rendered the entire transcript for every streamed
// token. Nothing about that fails visibly — it only gets slower — so it is
// pinned here.
describe("merge cache identity stability", () => {
  const streamOneFrame = (messages: ChatMessage[], frame: number): ChatMessage[] => {
    const next = messages.slice();
    const last = next[next.length - 1];
    next[next.length - 1] = { ...last, text: `streaming ${frame}` } as ChatMessage;
    return next;
  };

  const rebuiltPerFrame = (turns: number): number => {
    const messages = transcript(turns);
    const cache = new Map<string, MergedRun>();

    const first = mergeConsecutiveAssistantMessages(
      streamOneFrame(messages, 0).filter(messageRenders),
      cache,
    );
    const second = mergeConsecutiveAssistantMessages(
      streamOneFrame(messages, 1).filter(messageRenders),
      cache,
    );

    let changed = 0;
    for (let index = 0; index < first.length; index += 1) {
      if (first[index] !== second[index]) changed += 1;
    }
    return changed;
  };

  test("only the streaming turn changes identity, however long the conversation", () => {
    for (const turns of [10, 400, 600, 1200]) {
      assert.equal(
        rebuiltPerFrame(turns),
        1,
        `at ${turns} turns, ${rebuiltPerFrame(turns)} turns changed identity in one frame — ` +
          "every one of those re-renders in React",
      );
    }
  });

  test("the cache holds the transcript's runs and nothing else", () => {
    const cache = new Map<string, MergedRun>();
    mergeConsecutiveAssistantMessages(transcript(700).filter(messageRenders), cache);
    assert.equal(cache.size, 700);

    // Older history scrolled away: its entries must go with it rather than
    // linger, so the cache stays bounded by what is on screen.
    mergeConsecutiveAssistantMessages(transcript(3).filter(messageRenders), cache);
    assert.equal(cache.size, 3);
  });
});
