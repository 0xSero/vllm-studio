import { describe, expect, it } from "vitest";
import {
  byQuery,
  detectComposerMention,
  replaceComposerMention,
  selectedContextPrompt,
} from "./composer-context";

describe("composer context helpers", () => {
  it("detects plugin and skill mentions at the caret", () => {
    expect(detectComposerMention("use @bro")).toMatchObject({
      kind: "plugin",
      query: "bro",
      start: 4,
    });
    expect(detectComposerMention("load $agent")).toMatchObject({
      kind: "skill",
      query: "agent",
      start: 5,
    });
    expect(detectComposerMention("email@host")).toBeNull();
  });

  it("keeps mention menus open after trigger whitespace", () => {
    expect(detectComposerMention("use @   ")).toMatchObject({
      kind: "plugin",
      query: "",
      start: 4,
    });
    expect(detectComposerMention("load $ browser use")).toMatchObject({
      kind: "skill",
      query: "browser use",
      start: 5,
    });
  });

  it("replaces a trigger token with the selected mention label", () => {
    const mention = detectComposerMention("use @bro")!;
    expect(replaceComposerMention("use @bro", mention, "browser-use")).toBe("use @browser-use ");
  });

  it("prepends selected plugin and skill context without changing empty selections", () => {
    expect(selectedContextPrompt("hello")).toBe("hello");
    expect(
      selectedContextPrompt(
        "inspect localhost",
        [{ id: "browser", name: "browser-use", description: "Control the in-app browser." }],
        [
          {
            id: "agent",
            name: "agent-browser",
            path: "/skills/agent-browser",
            instructions: "# agent-browser\nUse browser automation.",
          },
        ],
      ),
    ).toContain("Enabled plugins: @browser-use.");
    expect(
      selectedContextPrompt(
        "inspect localhost",
        [],
        [{ id: "agent", name: "agent-browser", instructions: "Use browser automation." }],
      ),
    ).toContain("Use browser automation.");
  });

  it("filters rows with exact and prefix matches first", () => {
    expect(byQuery([{ name: "computer-use" }, { name: "browser-use" }], "bro")).toEqual([
      { name: "browser-use" },
    ]);
  });

  it("matches plugin display names and metadata across separators", () => {
    expect(
      byQuery(
        [
          { name: "browser-use", displayName: "Browser Use", source: "openai-bundled" },
          { name: "computer-use", displayName: "Computer Use", shortDescription: "Desktop UI" },
        ],
        "computer use",
      ),
    ).toEqual([
      { name: "computer-use", displayName: "Computer Use", shortDescription: "Desktop UI" },
    ]);
    expect(
      byQuery(
        [
          { name: "browser-use", displayName: "Browser Use", source: "openai-bundled" },
          { name: "local-tool", displayName: "Local Tool", source: "user" },
        ],
        "browser use",
      ),
    ).toEqual([{ name: "browser-use", displayName: "Browser Use", source: "openai-bundled" }]);
    expect(
      byQuery(
        [
          { name: "browser-use", displayName: "Browser Use", source: "openai-bundled" },
          { name: "local-tool", displayName: "Local Tool", source: "user" },
        ],
        "bundled",
      ),
    ).toEqual([{ name: "browser-use", displayName: "Browser Use", source: "openai-bundled" }]);
  });
});
