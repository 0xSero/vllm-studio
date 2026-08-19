import { existsSync, readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { listProjectsFromStore, resolveAllowedWorkspace } from "./projects-store";
import { hasEnabledConnectorsSync } from "./connectors-service";
import { resolveBundledResource } from "./plugin-resources";
import type { AgentThinkingLevel, AgentToolAccess } from "../../../shared/agent/agent-turn";

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
  thinkingLevel?: AgentThinkingLevel;
  toolAccess?: AgentToolAccess;
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  browserBackend?: "embedded" | "sitegeist";
  skills?: RuntimeSkillRef[];
  promptTemplates?: RuntimePromptTemplateRef[];
};

export type AgentSessionOptionsInput = {
  options: RuntimeStartOptions;
  /** Resolved session cwd, exported to extensions as LOCAL_STUDIO_CWD. */
  cwd?: string;
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
  if (process.env.LOCAL_STUDIO_AGENT_CWD) return process.env.LOCAL_STUDIO_AGENT_CWD;

  try {
    const usable = listProjectsFromStore().find((entry) => entry.exists);
    if (usable) return usable.path;
  } catch {
    // The project registry is optional during first run.
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
export function resolveAgentCwdEffect(input?: string): Effect.Effect<string, unknown> {
  const defaultCwd = resolveDefaultAgentCwd();
  const raw = input?.trim() || defaultCwd;
  const expanded = expandHome(raw);
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(defaultCwd, expanded);
  return Effect.gen(function* () {
    const resolved = yield* Effect.tryPromise({
      try: () => realpath(candidate),
      catch: (error) => error,
    });
    const info = yield* Effect.tryPromise({
      try: () => stat(resolved),
      catch: (error) => error,
    });
    if (!info.isDirectory()) {
      return yield* Effect.fail(new Error(`Agent cwd is not a directory: ${resolved}`));
    }
    return resolveAllowedWorkspace(resolved);
  });
}

// One resolver for every bundled resource (see plugin-resources) so the
// extension/MCP/skill lookup and the plugin lookup cannot drift apart again.
function resolveBundledResourcePath(kind: string, name: string, override?: string): string | null {
  if (override && existsSync(override)) return override;
  return resolveBundledResource(kind, name);
}

export function resolveBundledPiExtensionPath(
  fileName: string,
  envOverride?: string,
): string | null {
  return resolveBundledResourcePath("pi-extensions", fileName, envOverride);
}

// cua = computer use. One extension for every browser backend: it reads
// LOCAL_STUDIO_BROWSER_BACKEND itself and registers the same `browser_*` tool
// names either way, so switching backends no longer swaps the model's
// vocabulary out from under it.
export function resolveCuaExtensionPath(): string | null {
  return resolveBundledPiExtensionPath("cua.ts", process.env.LOCAL_STUDIO_CUA_EXTENSION_PATH);
}

/** Bundled stdio MCP servers (desktop/resources/mcp) — same ladder as extensions. */
export function resolveBundledMcpServerPath(fileName: string): string | null {
  return resolveBundledResourcePath("mcp", fileName);
}

export function resolveConnectorsExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "connectors.ts",
    process.env.LOCAL_STUDIO_CONNECTORS_EXTENSION_PATH,
  );
}

export function resolveSubagentsExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "subagents.ts",
    process.env.LOCAL_STUDIO_SUBAGENTS_EXTENSION_PATH,
  );
}

export function resolveAutomationsExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "automations.ts",
    process.env.LOCAL_STUDIO_AUTOMATIONS_EXTENSION_PATH,
  );
}

export function resolveTimeoutExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "local-studio-timeouts.ts",
    process.env.LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH,
  );
}

export function resolveAgentPolicyExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "local-studio-agent-policy.ts",
    process.env.LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH,
  );
}

// Locate a bundled skill directory (contains SKILL.md). Searched only when the
// matching tool surface is ON so it can be appended to the SDK skill list and
// teach the model how/when to use those tools.
function resolveBundledSkillPath(name: string, override?: string): string | null {
  return resolveBundledResourcePath("skills", name, override);
}

export function resolveCuaSkillPath(): string | null {
  return resolveBundledSkillPath("cua", process.env.LOCAL_STUDIO_CUA_SKILL_PATH);
}

export function resolveAutomationsSkillPath(): string | null {
  return resolveBundledSkillPath("automations", process.env.LOCAL_STUDIO_AUTOMATIONS_SKILL_PATH);
}

export function runtimeOptionsFingerprint(options: RuntimeStartOptions): string {
  const skills = (options.skills ?? [])
    .map((skill) => `${skill.name ?? ""}:${skill.path ?? ""}`)
    .sort();
  const promptTemplates = (options.promptTemplates ?? [])
    .map((template) => `${template.name ?? ""}:${template.path ?? ""}`)
    .sort();
  return JSON.stringify({
    thinkingLevel: options.thinkingLevel ?? "high",
    toolAccess: options.toolAccess ?? "full",
    browser: options.browserToolEnabled === true,
    browserBackend: browserBackend(options),
    browserSessionId: options.browserSessionId ?? "",
    skills,
    promptTemplates,
  });
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

export function deriveFrontendBase(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

function shouldLoadBrowserTool(options: RuntimeStartOptions): boolean {
  return options.browserToolEnabled === true;
}

function browserBackend(options: RuntimeStartOptions): "embedded" | "sitegeist" {
  const backend = options.browserBackend ?? process.env.LOCAL_STUDIO_BROWSER_BACKEND;
  if (backend === "sitegeist") return "sitegeist";
  return "embedded";
}

function runtimeExtensionPaths(options: RuntimeStartOptions): string[] {
  const timeoutExtensionPath = resolveTimeoutExtensionPath();
  const agentPolicyExtensionPath = resolveAgentPolicyExtensionPath();
  const cuaExtensionPath = shouldLoadBrowserTool(options) ? resolveCuaExtensionPath() : null;
  return uniqueExistingPaths([
    timeoutExtensionPath,
    agentPolicyExtensionPath,
    cuaExtensionPath,
    hasEnabledConnectorsSync() ? resolveConnectorsExtensionPath() : null,
    resolveSubagentsExtensionPath(),
    // Lets the agent create/list/delete scheduled automations.
    resolveAutomationsExtensionPath(),
    // NOTE: session-goal injection is no longer a bundled extension — it runs
    // in-process via createGoalPromptExtension (see pi-runtime.ts), keyed by the
    // canonical piSessionId. A bundled extension read the wrong id over RPC.
  ]);
}

function runtimeSkillPaths(options: RuntimeStartOptions): string[] {
  return uniqueExistingPaths([
    ...selectedSkillPaths(options.skills ?? []),
    shouldLoadBrowserTool(options) ? resolveCuaSkillPath() : null,
    // Unconditional, because the automations extension is: the tools are always
    // registered, so the guidance that says when to reach for them has to be
    // there too. Skills are progressively disclosed — this costs one line in
    // the prompt until the model opens it.
    resolveAutomationsSkillPath(),
  ]);
}

function runtimeEnvInjections(
  options: RuntimeStartOptions,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Record<string, string> {
  const frontendBase = env.LOCAL_STUDIO_FRONTEND_BASE ?? deriveFrontendBase(env);
  const relay = readSitegeistRelayEnv(env);
  return {
    // The cua extension picks its transport from this. It used to be implied by
    // which extension file got loaded; now that one extension serves both
    // backends, the choice has to reach the extension process explicitly.
    LOCAL_STUDIO_BROWSER_BACKEND: browserBackend(options),
    LOCAL_STUDIO_BROWSER_SESSION_ID: options.browserSessionId ?? "",
    // The project this session runs in. Extensions that spawn later work (the
    // automations extension) would otherwise store an empty cwd and get the
    // first registered project when the scheduler resolves the default.
    LOCAL_STUDIO_CWD: cwd,
    LOCAL_STUDIO_FRONTEND_BASE: frontendBase,
    SITEGEIST_RELAY_URL: env.SITEGEIST_RELAY_URL ?? relay.SITEGEIST_RELAY_URL ?? "",
    SITEGEIST_RELAY_TOKEN: env.SITEGEIST_RELAY_TOKEN ?? relay.SITEGEIST_RELAY_TOKEN ?? "",
    SITEGEIST_RELAY_SESSION_ID: options.browserSessionId ?? "",
  };
}

function readSitegeistRelayEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const filePath = expandHome(
    env.LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH ?? "~/.config/sitegeist-relay/env",
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
          return key.startsWith("SITEGEIST_RELAY_") ? [[key, value]] : [];
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

export function buildAgentSessionOptionsSync(input: AgentSessionOptionsInput): AgentSessionOptions {
  const options = input.options;
  return {
    extensionPaths: runtimeExtensionPaths(options),
    skills: runtimeSkillPaths(options),
    promptTemplatePaths: selectedPromptTemplatePaths(options.promptTemplates ?? []),
    envInjections: runtimeEnvInjections(options, input.processEnv ?? process.env, input.cwd ?? ""),
  };
}
