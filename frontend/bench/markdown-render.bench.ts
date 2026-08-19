/**
 * What does rendering one assistant message actually cost?
 *
 * The timeline spends ~3.5ms per newly mounted message (see finding 11), and
 * every assistant message goes through ReactMarkdown + remark-gfm. This splits
 * that: markdown pipeline vs plain React rendering, for plain-looking text and
 * for realistically marked-up text.
 *
 * The second axis is the point. A "skip markdown when the text has none" fast
 * path only helps if (a) markdown is actually the cost and (b) real messages
 * are often plain. Measuring only the synthetic plain-text case would make such
 * a path look far better than it is.
 *
 * Run: bun run bench/markdown-render.bench.ts (from frontend/, for react-dom)
 */
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

const PLAIN = `Answer to the question. ${"Detail sentence explaining the tradeoff. ".repeat(12)}`;

const MARKED_UP = `Here is what I found.

## Summary

The **primary** issue is in \`session-store.ts\`, and it affects _three_ call sites:

- \`loadSession\` — reads the whole file
- \`readTailRegion\` — bounded, fine
- \`activeBranchEvents\` — walks leaf-to-root

\`\`\`ts
const cached = cache.get(filepath);
if (cached && cached.size === stat.size) return cached.totals;
\`\`\`

| path | cost |
| --- | --- |
| cold | 306ms |
| warm | 10ms |

See [the ledger](https://example.com/ledger) for the full numbers.`;

const markdown = (text: string) =>
  renderToString(createElement(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS }, text));

const plainDiv = (text: string) =>
  renderToString(createElement("div", { className: "chat-markdown" }, text));

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

function time(label: string, run: () => string, iterations = 200): number {
  run(); // warm the JIT and the plugin pipeline
  const timings: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    run();
    timings.push(performance.now() - started);
  }
  const ms = median(timings);
  console.log(`${label.padEnd(38)} ${ms.toFixed(3)} ms`);
  return ms;
}

console.log(`per-message render cost — median of 200\n`);
const plainMd = time("plain text through ReactMarkdown", () => markdown(PLAIN));
const richMd = time("marked-up text through ReactMarkdown", () => markdown(MARKED_UP));
const plainRaw = time("plain text as a bare div", () => plainDiv(PLAIN));

console.log(`
A fast path that skips the markdown pipeline for plain-looking text saves
${(plainMd - plainRaw).toFixed(3)} ms per message — but only for messages that are
plain. Marked-up messages cost ${richMd.toFixed(3)} ms and would be unaffected.`);
