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

  it("replaces a trigger token with the selected mention label", () => {
    const mention = detectComposerMention("use @bro")!;
    expect(replaceComposerMention("use @bro", mention, "browser-use")).toBe("use @browser-use ");
  });

  it("prepends selected plugin and skill context without changing empty selections", () => {
    expect(selectedContextPrompt("hello")).toBe("hello");
    expect(
      selectedContextPrompt(
        "inspect localhost",
        [{ id: "browser", name: "browser-use" }],
        [{ id: "agent", name: "agent-browser", path: "/skills/agent-browser" }],
      ),
    ).toContain("Enabled plugins: @browser-use.");
  });

  it("filters rows with exact and prefix matches first", () => {
    expect(byQuery([{ name: "computer-use" }, { name: "browser-use" }], "bro")).toEqual([
      { name: "browser-use" },
    ]);
  });
});
