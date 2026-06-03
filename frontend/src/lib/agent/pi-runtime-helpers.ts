import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { packagesConfigToken, readEnabledOverrides } from "./pi-packages-store";
import { listProjectsFromStore } from "./projects-store";

export type RuntimePluginRef = {
  id?: string;
  name?: string;
  path?: string;
  skillPath?: string;
  mcpConfigPath?: string;
  appConfigPath?: string;
  appIds?: string[];
  appPath?: string;
  /**
   * Mirrors PluginRow.launch. "host-app" plugins (e.g. computer-use) ship a
   * bundled helper binary; their MCP is loaded when that binary actually
   * resolves on disk — see shouldLoadMcpConfig.
   */
  launch?: "standard" | "host-app";
};

export type RuntimeSkillRef = {
  id?: string;
  name?: string;
  path?: string;
};

export type RuntimePromptTemplateRef = {
  id?: string;
  name?: string;
  path?: string;
};

/**
 * Per-turn override for a single Pi extension. The runtime applies these on
 * top of the persistent `<agentDir>/extension-config/enabled.json` map without
 * writing to disk; this is how the composer's `/plugins` slash command toggles
 * extensions for the next turn only.
 */
export type RuntimeExtensionOverride = {
  /** Source string preferred, falls back to absolute path. */
  key: string;
  enabled: boolean;
};

export type RuntimeStartOptions = {
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  browserBackend?: "embedded" | "parchi" | "cdp";
  canvasEnabled?: boolean;
  plugins?: RuntimePluginRef[];
  skills?: RuntimeSkillRef[];
  promptTemplates?: RuntimePromptTemplateRef[];
  /** Per-turn extension overrides — empty array means "no per-turn override". */
  extensionOverrides?: RuntimeExtensionOverride[];
};

type RuntimeMcpConfig = {
  pluginName: string;
  configPath: string;
};

export type AgentSessionOptionsInput = {
  options: RuntimeStartOptions;
  processEnv?: NodeJS.ProcessEnv;
};

export type AgentSessionOptions = {
  // Absolute filesystem paths to .ts/.js extension modules. The SDK's
  // resource-loader uses jiti to load these; we hand paths instead of
  // pre-imported factories so we never trigger webpack's static analyser on a
  // dynamic `import(variable)` in the Next runtime bundle.
  extensionPaths: string[];
  skills: string[];
  /** Absolute prompt-template file/dir paths; forwarded to the SDK. */
  promptTemplatePaths: string[];
  /**
   * Per-turn extension on/off override map (key = source or path → enabled).
   * Empty when no `/plugins` overrides were specified for this turn.
   */
  extensionOverrides: Record<string, boolean>;
  envInjections: Record<string, string>;
};

function resolveDefaultAgentCwd(): string {
  if (process.env.VLLM_STUDIO_AGENT_CWD) return process.env.VLLM_STUDIO_AGENT_CWD;

  try {
    const usable = listProjectsFromStore().find((entry) => entry.exists);
    if (usable) return usable.path;
  } catch {
    // The project registry is optional during first run and test setup.
  }

  const cwd = process.cwd();
  if (path.basename(cwd) === "frontend") return path.resolve(cwd, "..");
  if (cwd === "/" || cwd === "") return homedir();
  return cwd;
}

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(homedir(), value.slice(2));
  return value;
}

// Resolve user-facing cwd input into the concrete directory Pi should run in.
// The default keeps packaged Electron launches out of "/" by preferring the
// selected project registry, then repo root during dev, then the user home.
export async function resolveAgentCwd(input?: string): Promise<string> {
  const defaultCwd = resolveDefaultAgentCwd();
  const raw = input?.trim() || defaultCwd;
  const expanded = expandHome(raw);
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(defaultCwd, expanded);
  const resolved = await realpath(candidate);
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`Agent cwd is not a directory: ${resolved}`);
  }
  return resolved;
}

// Locate bundled Pi extensions in both development checkouts and packaged
// Electron resource directories. Environment overrides keep this testable and
// let desktop packaging repair paths without changing runtime code.
export function resolveBundledPiExtensionPath(
  fileName: string,
  envOverride?: string,
): string | null {
  const candidates = [
    envOverride,
    process.resourcesPath
      ? path.join(process.resourcesPath, "desktop", "resources", "pi-extensions", fileName)
      : null,
    path.resolve(process.cwd(), "frontend", "desktop", "resources", "pi-extensions", fileName),
    path.resolve(process.cwd(), "desktop", "resources", "pi-extensions", fileName),
    path.resolve(
      process.cwd(),
      "..",
      "frontend",
      "desktop",
      "resources",
      "pi-extensions",
      fileName,
    ),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveBrowserExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "browser.ts",
    process.env.VLLM_STUDIO_BROWSER_EXTENSION_PATH,
  );
}

export function resolveParchiBrowserExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "parchi-browser.ts",
    process.env.VLLM_STUDIO_PARCHI_BROWSER_EXTENSION_PATH,
  );
}

export function resolveCdpBrowserExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "cdp-browser.ts",
    process.env.VLLM_STUDIO_CDP_BROWSER_EXTENSION_PATH,
  );
}

export function resolveCanvasExtensionPath(): string | null {
  return resolveBundledPiExtensionPath("canvas.ts", process.env.VLLM_STUDIO_CANVAS_EXTENSION_PATH);
}

export function resolveTimeoutExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "vllm-studio-timeouts.ts",
    process.env.VLLM_STUDIO_TIMEOUT_EXTENSION_PATH,
  );
}

export function resolveMcpExtensionPath(): string | null {
  return resolveBundledPiExtensionPath("mcp-plugin.ts", process.env.VLLM_STUDIO_MCP_EXTENSION_PATH);
}

// Locate a bundled skill directory (contains SKILL.md). Searched only when the
// matching tool surface is ON so it can be appended to the SDK skill list and
// teach the model how/when to use those tools.
function resolveBundledSkillPath(name: string, override?: string): string | null {
  const candidates = [
    override,
    process.resourcesPath
      ? path.join(process.resourcesPath, "desktop", "resources", "skills", name)
      : null,
    path.resolve(process.cwd(), "frontend", "desktop", "resources", "skills", name),
    path.resolve(process.cwd(), "desktop", "resources", "skills", name),
    path.resolve(process.cwd(), "..", "frontend", "desktop", "resources", "skills", name),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveBrowserSkillPath(): string | null {
  return resolveBundledSkillPath("browser", process.env.VLLM_STUDIO_BROWSER_SKILL_PATH);
}

export function resolveCanvasSkillPath(): string | null {
  return resolveBundledSkillPath("canvas", process.env.VLLM_STUDIO_CANVAS_SKILL_PATH);
}

export function pluginNameMatches(plugin: RuntimePluginRef, needle: string): boolean {
  return [
    plugin.id,
    plugin.name,
    plugin.path,
    plugin.skillPath,
    plugin.mcpConfigPath,
    plugin.appConfigPath,
    plugin.appPath,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

export function pluginFingerprint(options: RuntimeStartOptions): string {
  const names = (options.plugins ?? [])
    .map(
      (plugin) =>
        `${plugin.name ?? ""}:${plugin.path ?? ""}:${plugin.skillPath ?? ""}:${plugin.mcpConfigPath ?? ""}:${plugin.appConfigPath ?? ""}:${plugin.appIds?.join(",") ?? ""}:${plugin.appPath ?? ""}`,
    )
    .sort();
  const skills = (options.skills ?? [])
    .map((skill) => `${skill.name ?? ""}:${skill.path ?? ""}`)
    .sort();
  const promptTemplates = (options.promptTemplates ?? [])
    .map((template) => `${template.name ?? ""}:${template.path ?? ""}`)
    .sort();
  // Include the Pi-package enable/disable overrides so that toggling a Pi
  // extension on or off invalidates the cached runtime and the loader's
  // extensionsOverride filter is re-evaluated on the next session start.
  const overrides = Object.entries(readEnabledOverrides())
    .filter(([, enabled]) => enabled === false)
    .map(([key]) => key)
    .sort();
  // Per-turn `/plugins` overrides also invalidate the cached runtime — they
  // layer on top of the persisted overrides, so a turn that wants to re-enable
  // a globally disabled extension (or vice versa) needs a fresh session.
  const turnOverrides = (options.extensionOverrides ?? [])
    .map((entry) => `${entry.key}=${entry.enabled ? "1" : "0"}`)
    .sort();
  return JSON.stringify({
    browser: options.browserToolEnabled === true,
    browserBackend: options.browserBackend ?? process.env.VLLM_STUDIO_BROWSER_BACKEND ?? "embedded",
    browserSessionId: options.browserSessionId ?? "",
    canvas: options.canvasEnabled === true,
    plugins: names,
    skills,
    promptTemplates,
    extensionsDisabled: overrides,
    extensionsTurnOverride: turnOverrides,
    piPackagesToken: packagesConfigToken(),
  });
}

export function pluginSkillPaths(plugins: RuntimePluginRef[]): string[] {
  return uniqueExistingPaths(
    // Skip OpenAI's bundled `browser`/`chrome` skills: they hard-direct the
    // model to Codex's `node_repl` + `browser-client.mjs` bridge, which is
    // trust-locked to Codex's signed runtime and cannot run here. Our own
    // first-party chrome skill (under desktop/resources) is KEPT — it describes
    // the cdp_* tools the CDP backend registers.
    plugins
      .filter((plugin) => !isSuppressedBrowserSkill(plugin))
      .flatMap((plugin) => [
        plugin.skillPath,
        plugin.path && !plugin.path.endsWith(".app") ? path.join(plugin.path, "skills") : null,
      ]),
  );
}

export function selectedSkillPaths(skills: RuntimeSkillRef[]): string[] {
  return uniqueExistingPaths(skills.map((skill) => skill.path));
}

export function selectedPromptTemplatePaths(templates: RuntimePromptTemplateRef[]): string[] {
  return uniqueExistingPaths(templates.map((template) => template.path));
}

export function uniqueExistingPaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || !existsSync(value)) return false;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

export function pluginMcpConfigs(plugins: RuntimePluginRef[]): RuntimeMcpConfig[] {
  const seen = new Set<string>();
  return plugins.flatMap((plugin) => {
    const configPath =
      plugin.mcpConfigPath ??
      (plugin.path && !plugin.path.endsWith(".app") ? path.join(plugin.path, ".mcp.json") : null);
    if (!configPath || !existsSync(configPath)) return [];
    const resolved = path.resolve(configPath);
    if (seen.has(resolved)) return [];
    seen.add(resolved);
    return [
      { pluginName: plugin.name || path.basename(path.dirname(resolved)), configPath: resolved },
    ];
  });
}

export function deriveFrontendBase(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

function shouldLoadBrowserTool(options: RuntimeStartOptions, plugins: RuntimePluginRef[]): boolean {
  return (
    options.browserToolEnabled === true ||
    plugins.some((plugin) => isBrowserPlugin(plugin) || pluginNameMatches(plugin, "computer-use"))
  );
}

// The bundled Codex `browser` and `chrome` plugins (and the legacy `browser-use`
// name) all drive a web browser. vLLM Studio fulfils them with its OWN browser
// tooling (browser.ts / parchi) rather than Codex's in-app/native-host bridge,
// so selecting any of them turns the browser tool on. ("browser" matches
// "browser-use" too, since pluginNameMatches is a substring check.)
function isBrowserPlugin(plugin: RuntimePluginRef): boolean {
  return pluginNameMatches(plugin, "browser") || pluginNameMatches(plugin, "chrome");
}

// Suppress only OpenAI's bundled browser/chrome skills (their dead node_repl
// path). Our own first-party skill (under desktop/resources) is kept so the
// model gets cdp_* guidance.
function isSuppressedBrowserSkill(plugin: RuntimePluginRef): boolean {
  if (!isBrowserPlugin(plugin)) return false;
  const where = (plugin.path ?? "").toLowerCase();
  return where.includes("openai-bundled") || where.includes("/codex.app/");
}

function browserBackend(options: RuntimeStartOptions): "embedded" | "parchi" | "cdp" {
  const backend = options.browserBackend ?? process.env.VLLM_STUDIO_BROWSER_BACKEND;
  if (backend === "cdp") return "cdp";
  if (backend === "parchi") return "parchi";
  return "embedded";
}

// Selecting @chrome implies our CDP bridge (real, logged-in browser) unless a
// backend was explicitly chosen via option or env.
function effectiveBrowserBackend(
  options: RuntimeStartOptions,
  plugins: RuntimePluginRef[],
): "embedded" | "parchi" | "cdp" {
  const explicit = options.browserBackend ?? process.env.VLLM_STUDIO_BROWSER_BACKEND;
  if (explicit) return browserBackend(options);
  if (plugins.some((plugin) => pluginNameMatches(plugin, "chrome"))) return "cdp";
  return browserBackend(options);
}

function browserExtensionPathFor(backend: "embedded" | "parchi" | "cdp"): string | null {
  if (backend === "cdp") return resolveCdpBrowserExtensionPath();
  if (backend === "parchi") return resolveParchiBrowserExtensionPath();
  return resolveBrowserExtensionPath();
}

function runtimeExtensionPaths(
  options: RuntimeStartOptions,
  plugins: RuntimePluginRef[],
  mcpConfigs: RuntimeMcpConfig[],
): string[] {
  const timeoutExtensionPath = resolveTimeoutExtensionPath();
  const browserExtensionPath = shouldLoadBrowserTool(options, plugins)
    ? browserExtensionPathFor(effectiveBrowserBackend(options, plugins))
    : null;
  return uniqueExistingPaths([
    timeoutExtensionPath,
    mcpConfigs.length ? resolveMcpExtensionPath() : null,
    browserExtensionPath,
    options.canvasEnabled === true ? resolveCanvasExtensionPath() : null,
  ]);
}

function runtimeSkillPaths(options: RuntimeStartOptions, plugins: RuntimePluginRef[]): string[] {
  const loadBrowser = shouldLoadBrowserTool(options, plugins);
  return uniqueExistingPaths([
    ...pluginSkillPaths(plugins),
    ...selectedSkillPaths(options.skills ?? []),
    loadBrowser ? resolveBrowserSkillPath() : null,
    options.canvasEnabled === true ? resolveCanvasSkillPath() : null,
  ]);
}

function runtimeEnvInjections(
  options: RuntimeStartOptions,
  mcpConfigs: RuntimeMcpConfig[],
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const frontendBase = env.VLLM_STUDIO_FRONTEND_BASE ?? deriveFrontendBase(env);
  return {
    VLLM_STUDIO_BROWSER_SESSION_ID: options.browserSessionId ?? "",
    VLLM_STUDIO_FRONTEND_BASE: frontendBase,
    VLLM_STUDIO_MCP_PLUGIN_CONFIGS: JSON.stringify(mcpConfigs),
    PARCHI_RELAY_ORIGIN: env.PARCHI_RELAY_ORIGIN ?? frontendBase,
    PARCHI_RELAY_SESSION_ID: options.browserSessionId ?? "",
  };
}

export function applyRuntimeEnvInjections(
  envInjections: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(envInjections)) env[key] = value;
}

export async function buildAgentSessionOptions(
  input: AgentSessionOptionsInput,
): Promise<AgentSessionOptions> {
  const options = input.options;
  const plugins = options.plugins ?? [];
  const mcpConfigs = pluginMcpConfigs(plugins);
  return {
    extensionPaths: runtimeExtensionPaths(options, plugins, mcpConfigs),
    skills: runtimeSkillPaths(options, plugins),
    promptTemplatePaths: selectedPromptTemplatePaths(options.promptTemplates ?? []),
    extensionOverrides: extensionOverrideMap(options.extensionOverrides ?? []),
    envInjections: runtimeEnvInjections(options, mcpConfigs, input.processEnv ?? process.env),
  };
}

function extensionOverrideMap(entries: RuntimeExtensionOverride[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const entry of entries) {
    if (!entry.key) continue;
    map[entry.key] = entry.enabled;
  }
  return map;
}
