import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CodeBlock,
  Conversation,
  ConversationContent,
  Message,
  MessageContent,
  Loader,
  Plan,
  PlanStep,
  PromptInputSubmit,
  TokenUsage,
  copyCodeText,
  promptInputSubmitMode,
  scrollConversationToEnd,
  tokenUsageMetrics,
  tokenUsagePercent,
  tryCopyCodeText,
} from ".";

describe("reusable AI component behavior", () => {
  test("switches submit semantics between send and stop", () => {
    assert.deepEqual(promptInputSubmitMode("ready"), {
      active: false,
      label: "Send message",
      type: "submit",
    });
    assert.deepEqual(promptInputSubmitMode("streaming"), {
      active: true,
      label: "Stop response",
      type: "button",
    });
    const ready = renderToStaticMarkup(createElement(PromptInputSubmit, { status: "ready" }));
    const streaming = renderToStaticMarkup(
      createElement(PromptInputSubmit, { status: "streaming" }),
    );
    assert.match(ready, /type="submit"/);
    assert.match(streaming, /type="button"/);
    assert.match(streaming, /aria-busy="true"/);
  });

  test("scrolls only the supplied conversation target", () => {
    const calls: ScrollToOptions[] = [];
    const target = {
      scrollHeight: 480,
      scrollTo: (options: ScrollToOptions) => {
        calls.push(options);
      },
    } as unknown as HTMLElement;
    scrollConversationToEnd(target);
    scrollConversationToEnd(null);
    assert.deepEqual(calls, [{ top: 480, behavior: "smooth" }]);
  });

  test("copies code through an injected clipboard boundary", async () => {
    const copied: string[] = [];
    await copyCodeText("const result = 4;", {
      writeText: async (value) => {
        copied.push(value);
      },
    });
    assert.deepEqual(copied, ["const result = 4;"]);
    assert.equal(
      await tryCopyCodeText("denied", {
        writeText: async () => {
          throw new Error("Clipboard permission denied");
        },
      }),
      "failed",
    );
  });

  test("bounds token utilization and emits complete progress semantics", () => {
    assert.equal(tokenUsagePercent(40, 10, 100), 50);
    assert.equal(tokenUsagePercent(120, 20, 100), 100);
    assert.equal(tokenUsagePercent(1, 1, 0), null);
    assert.deepEqual(tokenUsageMetrics(-10, Number.NaN, Number.POSITIVE_INFINITY), {
      input: 0,
      output: 0,
      total: 0,
      limit: null,
      percent: null,
    });
    const markup = renderToStaticMarkup(
      createElement(TokenUsage, { input: 40, output: 10, limit: 100 }),
    );
    assert.match(markup, /aria-valuemin="0"/);
    assert.match(markup, /aria-valuemax="100"/);
    assert.match(markup, /aria-valuenow="50"/);
    const overLimit = renderToStaticMarkup(
      createElement(TokenUsage, { input: 120, output: 20, limit: 100 }),
    );
    assert.match(overLimit, /aria-valuenow="100"/);
  });

  test("routes send and stop callbacks to the correct control mode", () => {
    let sent = 0;
    let stopped = 0;
    const send = () => {
      sent += 1;
    };
    const stop = () => {
      stopped += 1;
    };
    const ready = PromptInputSubmit({ status: "ready", onClick: send });
    const streaming = PromptInputSubmit({
      status: "streaming",
      onClick: send,
      onStop: stop,
    });
    ready.props.onClick();
    streaming.props.onClick();
    assert.equal(sent, 1);
    assert.equal(stopped, 1);
  });

  test("announces every loader state without motion", () => {
    for (const state of ["pending", "streaming", "complete"] as const) {
      const markup = renderToStaticMarkup(createElement(Loader, { state, label: state }));
      assert.match(markup, new RegExp(`State: ${state}`));
      assert.match(markup, /role="status"/);
      assert.doesNotMatch(markup, /animate|rotate/);
    }
  });

  test("supports multiple plans without duplicate ids", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(
          Plan,
          { title: "Primary plan" },
          createElement(PlanStep, { state: "running", title: "Inspect" }),
        ),
        createElement(
          Plan,
          { title: "Recovery plan" },
          createElement(PlanStep, { state: "pending", title: "Restore" }),
        ),
      ),
    );
    assert.match(markup, /aria-label="Primary plan"/);
    assert.match(markup, /aria-label="Recovery plan"/);
    assert.doesNotMatch(markup, /\sid="/);
    assert.match(markup, /State: running/);
    assert.match(markup, /State: pending/);
  });

  test("produces stable server markup for repeated hydration inputs", () => {
    const tree = createElement(
      Conversation,
      null,
      createElement(
        ConversationContent,
        null,
        createElement(
          Message,
          { from: "assistant" },
          createElement(MessageContent, null, "Observed result"),
        ),
        createElement(CodeBlock, { code: "return 4;", language: "typescript" }),
        createElement(Loader, { state: "pending" }),
      ),
    );
    const first = renderToStaticMarkup(tree);
    const second = renderToStaticMarkup(tree);
    assert.equal(first, second);
    assert.match(first, /role="log"/);
    assert.match(first, /aria-label="Copy code"/);
    assert.doesNotMatch(first, /Date\.now|Math\.random|undefined/);
  });
});
