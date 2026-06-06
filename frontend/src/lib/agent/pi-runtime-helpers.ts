import { existsSync, readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { listProjectsFromStore } from "./projects-store";

export type RuntimePluginRef = {
  id?: string;
  name?: string;
  path?: string;
  skillPath?: string;
  mcpConfigPath?: string;
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

export type RuntimeStartOptions = {
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  browserBackend?: "embedded" | "parchi";
  canvasEnabled?: boolean;
  plugins?: RuntimePluginRef[];
  skills?: RuntimeSkillRef[];
  promptTemplates?: RuntimePromptTemplateRef[];
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

// Locate bundled first-party extensions in both development checkouts and packaged
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

export function resolveParchiBrowserSkillPath(): string | null {
  return resolveBundledSkillPath(
    "parchi-browser",
    process.env.VLLM_STUDIO_PARCHI_BROWSER_SKILL_PATH,
  );
}

export function resolveCanvasSkillPath(): string | null {
  return resolveBundledSkillPath("canvas", process.env.VLLM_STUDIO_CANVAS_SKILL_PATH);
}

export function pluginFingerprint(options: RuntimeStartOptions): string {
  const names = (options.plugins ?? [])
    .map(
      (plugin) =>
        `${plugin.name ?? ""}:${plugin.path ?? ""}:${plugin.skillPath ?? ""}:${plugin.mcpConfigPath ?? ""}`,
    )
    .sort();
  const skills = (options.skills ?? [])
    .map((skill) => `${skill.name ?? ""}:${skill.path ?? ""}`)
    .sort();
  const promptTemplates = (options.promptTemplates ?? [])
    .map((template) => `${template.name ?? ""}:${template.path ?? ""}`)
    .sort();
  return JSON.stringify({
    browser: options.browserToolEnabled === true,
    browserBackend: browserBackend(options),
    browserSessionId: options.browserSessionId ?? "",
    canvas: options.canvasEnabled === true,
    plugins: names,
    skills,
    promptTemplates,
  });
}

export function pluginSkillPaths(plugins: RuntimePluginRef[]): string[] {
  return uniqueExistingPaths(
    plugins.flatMap((plugin) => [
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

function shouldLoadBrowserTool(options: RuntimeStartOptions): boolean {
  return options.browserToolEnabled === true;
}

function browserBackend(options: RuntimeStartOptions): "embedded" | "parchi" {
  const backend = options.browserBackend ?? process.env.VLLM_STUDIO_BROWSER_BACKEND;
  if (backend === "parchi") return "parchi";
  return "embedded";
}

function browserExtensionPathFor(backend: "embedded" | "parchi"): string | null {
  if (backend === "parchi") return resolveParchiBrowserExtensionPath();
  return resolveBrowserExtensionPath();
}

function browserSkillPathFor(backend: "embedded" | "parchi"): string | null {
  if (backend === "parchi") return resolveParchiBrowserSkillPath();
  return resolveBrowserSkillPath();
}

function runtimeExtensionPaths(
  options: RuntimeStartOptions,
  mcpConfigs: RuntimeMcpConfig[],
): string[] {
  const timeoutExtensionPath = resolveTimeoutExtensionPath();
  const browserExtensionPath = shouldLoadBrowserTool(options)
    ? browserExtensionPathFor(browserBackend(options))
    : null;
  return uniqueExistingPaths([
    timeoutExtensionPath,
    mcpConfigs.length ? resolveMcpExtensionPath() : null,
    browserExtensionPath,
    options.canvasEnabled === true ? resolveCanvasExtensionPath() : null,
  ]);
}

function runtimeSkillPaths(options: RuntimeStartOptions, plugins: RuntimePluginRef[]): string[] {
  const loadBrowser = shouldLoadBrowserTool(options);
  const backend = browserBackend(options);
  return uniqueExistingPaths([
    ...pluginSkillPaths(plugins),
    ...selectedSkillPaths(options.skills ?? []),
    loadBrowser ? browserSkillPathFor(backend) : null,
    options.canvasEnabled === true ? resolveCanvasSkillPath() : null,
  ]);
}

function runtimeEnvInjections(
  options: RuntimeStartOptions,
  mcpConfigs: RuntimeMcpConfig[],
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const frontendBase = env.VLLM_STUDIO_FRONTEND_BASE ?? deriveFrontendBase(env);
  const parchiRelay = readParchiRelayEnv(env);
  return {
    VLLM_STUDIO_BROWSER_SESSION_ID: options.browserSessionId ?? "",
    VLLM_STUDIO_FRONTEND_BASE: frontendBase,
    VLLM_STUDIO_MCP_PLUGIN_CONFIGS: JSON.stringify(mcpConfigs),
    PARCHI_RELAY_URL:
      env.PARCHI_RELAY_RPC ??
      env.PARCHI_RELAY_URL ??
      parchiRelay.PARCHI_RELAY_RPC ??
      parchiRelay.PARCHI_RELAY_URL ??
      "",
    PARCHI_RELAY_TOKEN: env.PARCHI_RELAY_TOKEN ?? parchiRelay.PARCHI_RELAY_TOKEN ?? "",
    PARCHI_RELAY_ORIGIN: env.PARCHI_RELAY_ORIGIN ?? frontendBase,
    PARCHI_RELAY_SESSION_ID: options.browserSessionId ?? "",
  };
}

function readParchiRelayEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const filePath = expandHome(
    env.VLLM_STUDIO_PARCHI_RELAY_ENV_PATH ?? "~/.config/parchi-relay/env",
  );
  if (!existsSync(filePath)) return {};
  try {
    return Object.fromEntries(
      readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .flatMap((line): Array<[string, string]> => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return [];
          const clean = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
          const index = clean.indexOf("=");
          if (index < 1) return [];
          const key = clean.slice(0, index).trim();
          const value = clean
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          return key.startsWith("PARCHI_RELAY_") ? [[key, value]] : [];
        }),
    );
  } catch {
    return {};
  }
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
    extensionPaths: runtimeExtensionPaths(options, mcpConfigs),
    skills: runtimeSkillPaths(options, plugins),
    promptTemplatePaths: selectedPromptTemplatePaths(options.promptTemplates ?? []),
    envInjections: runtimeEnvInjections(options, mcpConfigs, input.processEnv ?? process.env),
  };
}
