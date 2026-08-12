/**
 * Per-frame timeline cost during streaming.
 *
 * A streaming turn commits a fresh `messages` array every animation frame, and
 * the timeline re-derives its visible list from it: filter, then stitch each
 * turn's assistant segments back into one bubble. Both walk the whole
 * transcript, so the work behind one new token scales with how long the
 * conversation already is.
 *
 * Two numbers matter, and the second one matters more:
 *
 *  - ms/frame is this derivation's own cost against a 16.7ms frame budget.
 *  - **rebuilt/frame** is how many settled turns came back with a new object
 *    identity, i.e. how many `MemoMessage` subtrees React re-renders for that
 *    one token. It should be 1 — the turn being streamed — at every size. This
 *    is not visible in ms here: the cost lands in React, not in this function.
 *
 * Imports the shipping implementation on purpose. An earlier version of this
 * bench kept its own copy, which is how a cache bug can be measured and then
 * quietly diverge from what users run.
 *
 * Run: bun run scripts/bench/timeline-merge.bench.ts
 */
import {
  mergeConsecutiveAssistantMessages,
  messageRenders,
  type MergedRun,
} from "../../frontend/src/features/agent/ui/timeline/visible-messages";
import type { ChatMessage } from "../../frontend/src/features/agent/messages";

/** Turns of the shape the merge exists for: an assistant run split by tools. */
function transcript(turns: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    messages.push({ id: `u${turn}`, role: "user", text: `prompt number ${turn}` } as ChatMessage);
    for (let segment = 0; segment < 3; segment += 1) {
      messages.push({
        id: `a${turn}-${segment}`,
        role: "assistant",
        text: `answer ${turn} part ${segment}`,
        blocks: [{ kind: "text", id: `b${turn}-${segment}`, text: "x".repeat(400) }],
      } as unknown as ChatMessage);
    }
  }
  return messages;
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const FRAMES = 40;

console.log(`per-frame timeline derivation — median of ${FRAMES} streamed frames\n`);
console.log("turns\tmsgs\tms/frame\t% of 16.7ms\trebuilt/frame");

for (const turns of [100, 400, 500, 600, 1000, 2000]) {
  const messages = transcript(turns);
  const cache = new Map<string, MergedRun>();
  const timings: number[] = [];
  const rebuilds: number[] = [];
  let previous: ChatMessage[] = [];

  for (let frame = 0; frame < FRAMES; frame += 1) {
    // Streaming replaces the last segment; everything before it is untouched,
    // which is exactly what the cache should make free.
    const streamed = messages.slice();
    const last = streamed[streamed.length - 1];
    streamed[streamed.length - 1] = { ...last, text: `answer streaming ${frame}` } as ChatMessage;

    const started = performance.now();
    const visible = mergeConsecutiveAssistantMessages(streamed.filter(messageRenders), cache);
    timings.push(performance.now() - started);

    if (previous.length === visible.length) {
      let changed = 0;
      for (let index = 0; index < visible.length; index += 1) {
        if (visible[index] !== previous[index]) changed += 1;
      }
      rebuilds.push(changed);
    }
    previous = visible;
  }

  const ms = median(timings);
  console.log(
    `${turns}\t${messages.length}\t${ms.toFixed(2)}\t\t${((ms / 16.7) * 100).toFixed(1)}%\t\t${median(rebuilds)}`,
  );
}

console.log("\nrebuilt/frame above 1 means settled turns are re-rendering for every token.");
