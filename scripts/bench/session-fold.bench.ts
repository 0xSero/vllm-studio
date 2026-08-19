/**
 * Session-load cost curve: how long foldSessionEvents takes as a transcript
 * grows. Event shapes copied from pi-event-applier.test.ts so the reducer
 * actually folds them. Run: bun run scripts/bench/session-fold.bench.ts (from frontend/, for the path aliases).
 */
import { foldSessionEvents } from "../../frontend/src/features/agent/runtime/pi-event-applier";

type Event = Record<string, unknown>;

const textPart = (text: string) => ({ type: "text", text });

/**
 * One turn shaped like a real rollout: the user's prompt echo, a streamed
 * assistant message that grows over `updates` frames, a tool call, and the
 * settled assistant message.
 */
function buildTurn(turn: number, updates: number): Event[] {
  const events: Event[] = [];
  events.push({
    type: "message_end",
    message: { role: "user", content: [textPart(`prompt number ${turn}`)] },
  });

  let text = "";
  events.push({
    type: "message_start",
    message: { role: "assistant", content: [textPart("")] },
  });
  for (let update = 0; update < updates; update += 1) {
    text += `token${update} `;
    events.push({
      type: "message_update",
      message: { role: "assistant", content: [textPart(text)] },
    });
  }
  events.push({
    type: "message_update",
    message: {
      role: "assistant",
      content: [
        textPart(text),
        {
          type: "toolCall",
          toolCallId: `call-${turn}`,
          toolName: "shell",
          args: { command: "ls -la" },
        },
      ],
    },
  });
  events.push({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        textPart(text),
        {
          type: "toolCall",
          toolCallId: `call-${turn}`,
          toolName: "shell",
          args: { command: "ls -la" },
          result: "a\nb\nc\n".repeat(20),
        },
      ],
    },
  });
  return events;
}

function buildLog(turns: number, updates: number): Event[] {
  const events: Event[] = [{ type: "session", timestamp: new Date(0).toISOString() }];
  for (let turn = 0; turn < turns; turn += 1) events.push(...buildTurn(turn, updates));
  return events;
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const SIZES = [25, 50, 100, 200, 400, 800];
const UPDATES = 40;
const RUNS = 5;

console.log(`fold cost — ${UPDATES} updates/turn, median of ${RUNS} runs\n`);
console.log("turns\tevents\tmsgs\tms\tµs/event\tscaling");

let previous: { turns: number; ms: number } | null = null;
for (const turns of SIZES) {
  const log = buildLog(turns, UPDATES);
  let messages = 0;
  const timings: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    const folded = foldSessionEvents(log);
    timings.push(performance.now() - started);
    messages = folded.messages.length;
  }
  const ms = median(timings);
  // >1 means cost per unit of work is climbing — superlinear in transcript size.
  const scaling =
    previous === null ? "—" : `${(ms / previous.ms / (turns / previous.turns)).toFixed(2)}x`;
  console.log(
    `${turns}\t${log.length}\t${messages}\t${ms.toFixed(1)}\t${((ms * 1000) / log.length).toFixed(2)}\t\t${scaling}`,
  );
  previous = { turns, ms };
}
console.log("\nscaling >1 = superlinear in transcript length; ~1 = linear");
