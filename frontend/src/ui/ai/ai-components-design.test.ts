import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as publicUi from "@/ui";
import {
  AgentCard,
  ChainOfThought,
  CodeBlock,
  Conversation,
  ConversationContent,
  InlineCitation,
  Loader,
  Message,
  MessageContent,
  Plan,
  PlanStep,
  PromptInput,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
  ReasoningSummary,
  Suggestion,
  Thought,
  TokenUsage,
  ToolUse,
} from ".";

const files = ["message", "conversation", "prompt-input", "feedback", "artifacts"].map((name) =>
  readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8"),
);
const source = files.join("\n");

describe("reusable AI component design contract", () => {
  test("exports every requested observable surface", () => {
    for (const component of [
      "Message",
      "Conversation",
      "PromptInput",
      "Reasoning",
      "ReasoningSummary",
      "ToolUse",
      "AgentCard",
      "CodeBlock",
      "Loader",
      "Suggestion",
      "InlineCitation",
      "Plan",
      "PlanStep",
      "ChainOfThought",
      "Thought",
      "TokenUsage",
    ]) {
      assert.match(source, new RegExp(`function ${component}`));
    }
  });

  test("publishes the complete component contract from the root UI barrel", () => {
    for (const component of [
      "Message",
      "Conversation",
      "PromptInput",
      "Reasoning",
      "ReasoningSummary",
      "ToolUse",
      "AgentCard",
      "CodeBlock",
      "Loader",
      "Suggestion",
      "InlineCitation",
      "Plan",
      "PlanStep",
      "ChainOfThought",
      "Thought",
      "TokenUsage",
    ]) {
      assert.ok(component in publicUi, `${component} is not publicly exported`);
    }
  });

  test("keeps reasoning observable without exposing hidden chain of thought", () => {
    assert.match(source, /Reasoning summary/);
    assert.match(source, /Observable reasoning/);
    assert.doesNotMatch(source, /hidden reasoning|internal chain|private thought|raw reasoning/i);
  });

  test("provides keyboard, live-region, progress and reduced-motion semantics", () => {
    assert.match(source, /role="log"/);
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /role="progressbar"/);
    assert.match(source, /focus-visible:ring-2/);
    assert.match(source, /min-h-11/);
  });

  test("uses DS tokens and all-mode forced-color fallbacks without proof misuse", () => {
    assert.match(source, /border-\(--ui-border\)/);
    assert.match(source, /forced-colors:/);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}|--proof|--emergency|gradient|shadow-/i);
  });

  test("does not copy provider brands or introduce status by color alone", () => {
    assert.doesNotMatch(source, /vercel|openai|anthropic|shadcn/i);
    assert.match(source, /State: \{state\}/);
    assert.match(source, /\{state\}/);
  });

  test("centralizes icons and uses non-rotating loader states", () => {
    assert.doesNotMatch(source, /from "lucide-react"/);
    assert.match(source, /@\/ui\/icon-registry/);
    assert.doesNotMatch(source, /rotate-|animate-spin/);
    assert.match(source, /"pending" \| "streaming" \| "complete"/);
  });

  test("forbids decorative pills, proof color and animated disclosure motion", () => {
    assert.doesNotMatch(source, /rounded-full|rounded-\[|--proof|--emergency/);
    assert.doesNotMatch(source, /animate-|rotate-|pulse|glow/);
    assert.match(source, /forced-colors:border-\[CanvasText\]/);
  });

  test("renders the composed surface with semantic HTML", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Conversation,
        null,
        createElement(
          ConversationContent,
          null,
          createElement(
            Message,
            { from: "assistant" },
            createElement(MessageContent, null, "Result"),
          ),
          createElement(ReasoningSummary, { summary: "Compared observable evidence." }),
          createElement(ToolUse, { name: "Search", state: "completed" }),
          createElement(AgentCard, { name: "Verifier", role: "Review", status: "idle" }),
          createElement(CodeBlock, { code: "return true;", language: "typescript" }),
          createElement(
            Plan,
            null,
            createElement(PlanStep, { state: "completed", title: "Inspect evidence" }),
          ),
          createElement(
            ChainOfThought,
            null,
            createElement(Thought, { title: "Evidence compared" }),
          ),
          createElement(TokenUsage, { input: 10, output: 4, limit: 100 }),
          createElement(Loader),
          createElement(Suggestion, null, "Inspect receipt"),
          createElement(InlineCitation, {
            href: "https://example.invalid/source",
            index: 1,
            title: "Source",
          }),
        ),
        createElement(
          PromptInput,
          null,
          createElement(
            PromptInputBody,
            null,
            createElement(PromptInputTextarea),
            createElement(PromptInputSubmit),
          ),
        ),
      ),
    );
    assert.match(markup, /role="log"/);
    assert.match(markup, /aria-label="Agent message"/);
    assert.match(markup, /aria-label="Token usage"/);
    assert.match(markup, /aria-label="Send message"/);
  });
});
