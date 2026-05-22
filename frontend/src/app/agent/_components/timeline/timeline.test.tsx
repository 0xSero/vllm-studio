import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/agent/session";
import { Timeline } from "./timeline";

vi.mock("./message-view", async () => {
  const React = await import("react");

  return {
    MessageView: ({ message }: { message: ChatMessage }) =>
      React.createElement("div", { "data-message-id": message.id }, message.text),
  };
});

const messages: ChatMessage[] = [
  { id: "sys", role: "system", text: "hidden system note" },
  { id: "user", role: "user", text: "hello" },
  { id: "assistant", role: "assistant", text: "answer", blocks: [] },
];

describe("Timeline", () => {
  it("keeps the empty prompt outside the scrollable list", () => {
    const html = renderToStaticMarkup(<Timeline messages={messages} running={false} emptyPrompt />);

    expect(html).toContain("A dream is something you build for yourself.");
    expect(html).not.toContain("data-timeline-scroller");
  });

  it("renders non-system messages inside the scroller", () => {
    const html = renderToStaticMarkup(<Timeline messages={messages} running={false} />);

    expect(html).toContain("data-timeline-scroller");
    expect(html).not.toContain("hidden system note");
    expect(html).toContain('data-message-id="user"');
    expect(html).toContain('data-message-id="assistant"');
  });

  it("renders a running indicator when streaming", () => {
    const html = renderToStaticMarkup(
      <Timeline messages={messages} running statusLabel="thinking" />,
    );

    expect(html).toContain("Pi is thinking");
  });

  it("splits the scroll container from the timeline list and pins scroll CSS", () => {
    const html = renderToStaticMarkup(<Timeline messages={messages} running={false} />);

    expect(html).toContain("data-timeline-list");
    expect(html).toContain("[scrollbar-gutter:stable_both-edges]");
    expect(html).toContain("[scroll-behavior:auto]");
    expect(html).toContain("[overflow-anchor:none]");
    expect(html).toContain("[content-visibility:auto]");
    expect(html).toContain("[contain-intrinsic-size:auto_240px]");
  });
});
