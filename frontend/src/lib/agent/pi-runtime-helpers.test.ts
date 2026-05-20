import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __resetDataDirCacheForTests } from "@/lib/data-dir";
import {
  buildPiLaunchPlan,
  deriveFrontendBase,
  expandHome,
  isPathInside,
  normalizeBackendUrl,
  pluginFingerprint,
  pluginMcpConfigs,
  pluginNameMatches,
  resolveAgentCwd,
  resolveBundledPiExtensionPath,
  selectedSkillPaths,
  uniqueExistingPaths,
} from "./pi-runtime-helpers";

const originalEnv = { ...process.env };
const originalCwd = process.cwd();
const roots: string[] = [];

function makeRoot(prefix = "vllm-pi-runtime-"): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  process.env = { ...originalEnv };
  process.chdir(originalCwd);
  __resetDataDirCacheForTests();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("pi runtime helper seams", () => {
  it("normalizes backend URLs and frontend callback base", () => {
    process.env.PORT = "3001";

    expect(normalizeBackendUrl(" http://localhost:8080/// ")).toBe("http://localhost:8080");
    expect(deriveFrontendBase()).toBe("http://127.0.0.1:3001");
  });

  it("resolves agent cwd from overrides, relative inputs, and home aliases", async () => {
    const root = makeRoot();
    const workspace = path.join(root, "workspace");
    const child = path.join(workspace, "child");
    mkdirSync(child, { recursive: true });
    process.env.VLLM_STUDIO_AGENT_CWD = workspace;

    expect(await resolveAgentCwd("child")).toBe(realpathSync(child));
    expect(expandHome("~")).toBe(process.env.HOME);
  });

  it("keeps plugin fingerprints stable when selections are reordered", () => {
    const first = pluginFingerprint({
      browserToolEnabled: true,
      plugins: [
        { name: "B", path: "/b" },
        { name: "A", path: "/a" },
      ],
      skills: [
        { name: "docs", path: "/docs" },
        { name: "tests", path: "/tests" },
      ],
    });
    const second = pluginFingerprint({
      browserToolEnabled: true,
      plugins: [
        { name: "A", path: "/a" },
        { name: "B", path: "/b" },
      ],
      skills: [
        { name: "tests", path: "/tests" },
        { name: "docs", path: "/docs" },
      ],
    });

    expect(first).toBe(second);
  });

  it("matches plugin names across all plugin reference fields", () => {
    expect(
      pluginNameMatches(
        {
          id: "id",
          name: "Display",
          path: "/plugins/browser-use",
          skillPath: "/skills",
          mcpConfigPath: "/mcp",
        },
        "browser-use",
      ),
    ).toBe(true);
  });

  it("deduplicates selected paths and ignores missing paths", () => {
    const root = makeRoot();
    const skills = path.join(root, "skills");
    mkdirSync(skills);

    expect(
      uniqueExistingPaths([skills, `${skills}/../skills`, path.join(root, "missing")]),
    ).toEqual([skills]);
    expect(selectedSkillPaths([{ path: skills }, { path: path.join(root, "missing") }])).toEqual([
      skills,
    ]);
  });

  it("locates bundled Pi extensions from explicit overrides", () => {
    const root = makeRoot();
    const extension = path.join(root, "browser.ts");
    writeFileSync(extension, "export default {}\n");

    expect(resolveBundledPiExtensionPath("browser.ts", extension)).toBe(extension);
  });

  it("builds the Pi launch plan with stable args, env, skills, and extensions", () => {
    const root = makeRoot();
    const pluginSkills = path.join(root, "plugin", "skills");
    const selectedSkills = path.join(root, "selected-skills");
    const timeoutExtension = path.join(root, "vllm-studio-timeouts.ts");
    const mcpExtension = path.join(root, "mcp-plugin.ts");
    const browserExtension = path.join(root, "browser.ts");
    const canvasExtension = path.join(root, "canvas.ts");
    const mcpConfigPath = path.join(root, "plugin", ".mcp.json");
    mkdirSync(pluginSkills, { recursive: true });
    mkdirSync(selectedSkills, { recursive: true });
    for (const file of [
      timeoutExtension,
      mcpExtension,
      browserExtension,
      canvasExtension,
      mcpConfigPath,
    ]) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, file.endsWith(".json") ? JSON.stringify({ mcpServers: {} }) : "");
    }
    process.env.VLLM_STUDIO_TIMEOUT_EXTENSION_PATH = timeoutExtension;
    process.env.VLLM_STUDIO_MCP_EXTENSION_PATH = mcpExtension;
    process.env.VLLM_STUDIO_BROWSER_EXTENSION_PATH = browserExtension;
    process.env.VLLM_STUDIO_CANVAS_EXTENSION_PATH = canvasExtension;

    const plan = buildPiLaunchPlan({
      agentDir: path.join(root, "agent"),
      modelId: "qwen",
      options: {
        canvasEnabled: true,
        plugins: [{ name: "browser-use", path: path.join(root, "plugin") }],
        skills: [{ name: "selected", path: selectedSkills }],
      },
      pathEnv: "/tmp/pi-bin",
      piSessionId: "session-123",
      processEnv: { ...process.env, VLLM_STUDIO_FRONTEND_BASE: "http://frontend.test" },
      providerId: "vllm-studio",
      selectedModel: { reasoning: true },
    });

    expect(plan.args).toEqual([
      "--mode",
      "rpc",
      "--provider",
      "vllm-studio",
      "--model",
      "vllm-studio/qwen",
      "--thinking",
      "high",
      "--session",
      "session-123",
      "--skill",
      pluginSkills,
      "--skill",
      selectedSkills,
      "--extension",
      timeoutExtension,
      "--extension",
      mcpExtension,
      "--extension",
      browserExtension,
      "--extension",
      canvasExtension,
    ]);
    expect(plan.env).toMatchObject({
      PATH: "/tmp/pi-bin",
      PI_CODING_AGENT_DIR: path.join(root, "agent"),
      PI_SKIP_VERSION_CHECK: "1",
      VLLM_STUDIO_FRONTEND_BASE: "http://frontend.test",
      VLLM_STUDIO_MCP_PLUGIN_CONFIGS: JSON.stringify([
        { pluginName: "browser-use", configPath: mcpConfigPath },
      ]),
    });
  });

  it("filters launch-constrained Computer Use MCP configs unless explicitly allowed", () => {
    const root = makeRoot();
    process.env.VLLM_STUDIO_DATA_DIR = path.join(root, "data");
    mkdirSync(process.env.VLLM_STUDIO_DATA_DIR, { recursive: true });
    writeFileSync(path.join(process.env.VLLM_STUDIO_DATA_DIR, "api-settings.json"), "{}");
    const configPath = path.join(root, ".mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { computerUse: { command: "SkyComputerUseClient" } } }),
    );

    expect(pluginMcpConfigs([{ name: "computer-use", mcpConfigPath: configPath }])).toEqual([]);

    process.env.VLLM_STUDIO_ENABLE_CODEX_COMPUTER_USE_MCP = "1";
    expect(pluginMcpConfigs([{ name: "computer-use", mcpConfigPath: configPath }])).toEqual([
      { pluginName: "computer-use", configPath },
    ]);
  });

  it("allows local Computer Use helper MCP configs and rejects sibling escapes", () => {
    const dataRoot = makeRoot();
    process.env.VLLM_STUDIO_DATA_DIR = dataRoot;
    writeFileSync(path.join(dataRoot, "api-settings.json"), "{}");
    const helperRoot = path.join(dataRoot, "computer-use");
    const configPath = path.join(helperRoot, ".mcp.json");
    mkdirSync(helperRoot, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { computerUse: { command: "SkyComputerUseClient" } } }),
    );

    expect(isPathInside(configPath, helperRoot)).toBe(true);
    expect(isPathInside(path.join(dataRoot, "computer-use-evil", ".mcp.json"), helperRoot)).toBe(
      false,
    );
    expect(pluginMcpConfigs([{ name: "computer-use", mcpConfigPath: configPath }])).toEqual([
      { pluginName: "computer-use", configPath },
    ]);
  });
});
