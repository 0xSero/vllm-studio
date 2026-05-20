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

  it("renders git diff output with the same highlighted source treatment", () => {
    const block: ToolBlock = {
      kind: "tool",
      id: "diff-1",
      name: "git_diff",
      status: "done",
      text: "",
      resultText:
        "diff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-const oldValue = 0;\n+const newValue = 1;\n",
    };

    const html = renderToStaticMarkup(<ToolBlockView block={block} />);

    expect(html).toContain("Git Diff");
    expect(html).toContain("language-diff");
    expect(html).toContain("hljs-addition");
    expect(html).toContain("hljs-deletion");
  });
});
