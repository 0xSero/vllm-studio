import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolBlock } from "@/lib/agent/session";
import { ToolBlockView } from "./tool-block-view";

describe("ToolBlockView", () => {
  it("renders highlighted source for file write previews", () => {
    const block: ToolBlock = {
      kind: "tool",
      id: "write-1",
      name: "write_file",
      status: "done",
      text: "",
      args: {
        path: "src/example.ts",
        content: "const value: number = 1;\n",
      },
    };

    const html = renderToStaticMarkup(<ToolBlockView block={block} />);

    expect(html).toContain("language-ts");
    expect(html).toContain("hljs-keyword");
  });

  it("renders edit patches with diff highlighting", () => {
    const block: ToolBlock = {
      kind: "tool",
      id: "patch-1",
      name: "apply_patch",
      status: "done",
      text: "",
      args: {
        path: "src/example.ts",
        patch: "+const value = 1;\n-const value = 0;\n",
      },
    };

    const html = renderToStaticMarkup(<ToolBlockView block={block} />);

    expect(html).toContain("language-diff");
    expect(html).toContain("hljs-addition");
    expect(html).toContain("hljs-deletion");
  });
});
