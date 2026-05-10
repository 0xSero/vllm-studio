import { describe, expect, it } from "vitest";
import {
  activateComposerPlugin,
  activeComposerPlugins,
  byQuery,
  consumeComposerMention,
  detectComposerMention,
  replaceComposerMention,
  sanitizeComposerPlugins,
  sanitizeComposerSkills,
  selectedContextInstructions,
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

  it("consumes selected mentions so composer tabs become the source of truth", () => {
    expect(consumeComposerMention("use @bro", detectComposerMention("use @bro")!)).toBe("use");
    expect(consumeComposerMention("@browser inspect page", detectComposerMention("@browser")!)).toBe(
      "inspect page",
    );
    expect(consumeComposerMention("load $agent now", detectComposerMention("load $agent")!)).toBe(
      "load now",
    );
  });

  it("prepends selected plugin and skill context without changing empty selections", () => {
    expect(selectedContextPrompt("hello")).toBe("hello");
    expect(
      selectedContextPrompt(
        "inspect localhost",
        [
        {
          id: "browser",
          name: "browser-use",
          description: "Control the in-app browser.",
          instructions: "# Browser\nUse the in-app browser runtime.",
          defaultPrompts: ["Inspect the current page"],
        },
        ],
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
      selectedContextPrompt("inspect localhost", [
        { id: "browser", name: "browser-use", instructions: "# Browser\nUse IAB." },
      ]),
    ).toContain("Plugin @browser-use instructions:\n# Browser\nUse IAB.");
    expect(
      selectedContextPrompt("inspect localhost", [
        {
          id: "browser",
          name: "browser-use",
          defaultPrompts: ["Inspect the current page"],
          appIds: ["connector_browser"],
        },
      ]),
    ).toContain("Plugin @browser-use default prompts: Inspect the current page");
    expect(
      selectedContextPrompt("inspect localhost", [
        {
          id: "browser",
          name: "browser-use",
          appIds: ["connector_browser"],
        },
      ]),
    ).toContain("Plugin @browser-use declares app connectors: connector_browser");
    expect(
      selectedContextPrompt("inspect localhost", [
        {
          id: "computer",
          name: "computer-use",
          path: "/plugins/computer-use",
          skillPath: "/plugins/computer-use/skills",
          mcpConfigPath: "/plugins/computer-use/.mcp.json",
          appConfigPath: "/plugins/computer-use/apps.json",
          appPath: "/plugins/computer-use/Codex Computer Use.app",
        },
      ]),
    ).toContain(
      "Plugin @computer-use runtime: plugin=/plugins/computer-use; skills=/plugins/computer-use/skills; mcp=/plugins/computer-use/.mcp.json; apps=/plugins/computer-use/apps.json; app=/plugins/computer-use/Codex Computer Use.app",
    );
    expect(
      selectedContextPrompt(
        "inspect localhost",
        [],
        [{ id: "agent", name: "agent-browser", instructions: "Use browser automation." }],
      ),
    ).toContain("Use browser automation.");
  });

  it("excludes disabled plugins from composer context and runtime selections", () => {
    const plugins = [
      { id: "browser", name: "browser-use" },
      { id: "computer", name: "computer-use", enabled: false },
    ];

    expect(activeComposerPlugins(plugins).map((plugin) => plugin.name)).toEqual(["browser-use"]);
    const prompt = selectedContextPrompt("inspect the page", plugins);
    expect(prompt).toContain("Enabled plugins: @browser-use.");
    expect(prompt).not.toContain("@computer-use");
  });

  it("locally activates a selected plugin without mutating global Codex config", () => {
    expect(
      activeComposerPlugins([
        activateComposerPlugin({ id: "computer", name: "computer-use", enabled: false }),
      ]),
    ).toEqual([{ id: "computer", name: "computer-use", enabled: true }]);
  });

  it("sanitizes API plugin and skill payloads before runtime loading", () => {
    const plugins = sanitizeComposerPlugins([
      {
        id: "browser",
        name: "browser-use",
        enabled: true,
        mcpConfigPath: "/plugins/browser/.mcp.json",
        appIds: ["connector_browser", 123],
      },
      { id: "computer", name: "computer-use", enabled: false, mcpConfigPath: "/nope" },
      { name: "" },
    ]);
    const skills = sanitizeComposerSkills([
      { id: "agent", name: "agent-browser", path: "/skills/agent-browser" },
      null,
    ]);

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      id: "browser",
      name: "browser-use",
      enabled: true,
      mcpConfigPath: "/plugins/browser/.mcp.json",
      appIds: ["connector_browser"],
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "agent",
      name: "agent-browser",
      path: "/skills/agent-browser",
    });
  });

  it("preserves plugin source identity in composer context", () => {
    const prompt = selectedContextPrompt("inspect", [
      { id: "one", name: "browser-use", source: "openai-bundled" },
      { id: "two", name: "browser-use", source: "local-market" },
    ]);

    expect(prompt).toContain("@browser-use (openai-bundled)");
    expect(prompt).toContain("@browser-use (local-market)");
  });

  it("tells computer-use sessions to inspect MCP status before desktop control", () => {
    expect(
      selectedContextPrompt("control the desktop", [
        { id: "computer", name: "computer-use", displayName: "Computer Use" },
      ]),
    ).toContain("call mcp_plugin_status before desktop control");
  });

  it("recognizes core plugins case-insensitively from display metadata", () => {
    expect(
      selectedContextPrompt("inspect", [
        { id: "browser", name: "BrowserUse", displayName: "Browser-Use" },
      ]),
    ).toContain("Browser-use is enabled");
    expect(
      selectedContextPrompt("control", [
        { id: "computer", name: "ComputerUse", displayName: "Computer-Use" },
      ]),
    ).toContain("call mcp_plugin_status");
  });

  it("builds reusable compaction instructions for selected plugins and skills", () => {
    const instructions = selectedContextInstructions(
      [{ id: "browser", name: "browser-use", shortDescription: "Browser control" }],
      [{ id: "skill", name: "agent-browser", instructions: "Use the browser harness." }],
    );

    expect(instructions).toContain("Preserve this selected composer context after compaction.");
    expect(instructions).toContain("Enabled plugins: @browser-use.");
    expect(instructions).toContain("Use the browser harness.");
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
