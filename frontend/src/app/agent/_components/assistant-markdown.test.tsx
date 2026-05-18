import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMarkdown } from "./assistant-markdown";

describe("AssistantMarkdown", () => {
  it("renders fenced code with a dark highlighted shell and copy control", () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown
        text={[
          "Here is the snippet:",
          "",
          "```ts",
          "const value = 1;",
          "export function read() {",
          "  return value;",
          "}",
          "```",
        ].join("\n")}
      />,
    );

    expect(html).toContain("chat-markdown");
    expect(html).toContain("assistant-code-block");
    expect(html).toContain("Copy code");
    expect(html).toContain(">ts<");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("hljs-number");
  });
});
