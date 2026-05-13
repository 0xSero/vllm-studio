import { describe, expect, it, vi } from "vitest";
import { ContextManagementService } from "./service";
import { DEFAULT_CONTEXT_CONFIG, type ContextMessage } from "./types";

const service = new ContextManagementService({
  ...DEFAULT_CONTEXT_CONFIG,
  preserveRecentMessages: 2,
  targetAfterCompaction: 0.5,
});

const messages: ContextMessage[] = [
  { role: "system", content: "rules" },
  { role: "user", content: "first user message" },
  { role: "assistant", content: "first assistant reply" },
  { role: "user", content: "second user message" },
  { role: "assistant", content: "second assistant reply" },
];

describe("context management service", () => {
  it("estimates tokens, formats counts, and classifies utilization", () => {
    expect(service.estimateTokens("")).toBe(0);
    expect(service.estimateTokens("12345")).toBe(2);
    expect(service.formatTokenCount(999)).toBe("999");
    expect(service.formatTokenCount(12_300)).toBe("12.3K");
    expect(service.formatTokenCount(1_250_000)).toBe("1.3M");
    expect([0.49, 0.5, 0.75, 0.9].map((value) => service.getUtilizationLevel(value))).toEqual([
      "low",
      "medium",
      "high",
      "critical",
    ]);
  });

  it("calculates context stats from prompt, tools, and conversation", () => {
    const stats = service.calculateStats(messages.slice(0, 2), 1000, "system prompt", [
      { name: "browser" },
    ]);

    expect(stats).toMatchObject({
      maxContext: 1000,
      messagesCount: 2,
      systemPromptTokens: 4,
      toolsTokens: 5,
    });
    expect(stats.currentTokens).toBe(
      stats.systemPromptTokens + stats.toolsTokens + stats.conversationTokens,
    );
    expect(stats.headroom).toBe(1000 - stats.currentTokens);
    expect(stats.estimatedMessagesUntilLimit).toBeGreaterThan(0);
  });

  it("compacts with sliding-window and truncate strategies while preserving recent messages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T01:00:00.000Z"));

    const sliding = service.compactMessages(messages, 40, "sliding_window");
    const truncated = service.compactMessages(messages, 40, "truncate");

    expect(sliding.messages.slice(-2)).toEqual(messages.slice(-2));
    expect(truncated.messages.slice(-2)).toEqual(messages.slice(-2));
    expect(sliding.event).toMatchObject({
      id: "compact-1778547600000",
      strategy: "sliding_window",
      maxContext: 40,
      messagesKept: sliding.messages.length,
    });
    expect(truncated.event.messagesRemoved).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it("summarizes older non-system messages when asked", () => {
    const result = service.compactMessages(messages, 200, "summarize");

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toMatchObject({ role: "system" });
    expect(result.messages[0]?.content).toContain("Previous conversation summary");
    expect(result.messages[0]?.content).not.toContain("rules");
    expect(result.event.summary).toBe(result.messages[0]?.content);
  });
});
