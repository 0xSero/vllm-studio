import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Effect, Schema } from "effect";
import { probeConnector } from "./connector-pool";
import { listConnectors, upsertConnectors, type ConnectorConfig } from "./connectors-service";
import {
  discoverPluginBundles,
  type PluginBundle,
  type PluginSource,
  type PluginView,
} from "./plugin-discovery";

const StringRecord = Schema.Record(Schema.String, Schema.String);

const StdioServerSchema = Schema.Struct({
  type: Schema.optional(Schema.Literal("stdio")),
  command: Schema.String,
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(StringRecord),
  cwd: Schema.optional(Schema.String),
});

const HttpServerSchema = Schema.Struct({
  type: Schema.Literal("http"),
  url: Schema.String,
  headers: Schema.optional(StringRecord),
  bearer_token_env_var: Schema.optional(Schema.String),
  oauth_resource: Schema.optional(Schema.String),
});

const McpServerSchema = Schema.Union([StdioServerSchema, HttpServerSchema]);
const McpManifestSchema = Schema.Struct({
  mcpServers: Schema.Record(Schema.String, Schema.Unknown),
});

type PluginToolState =
  | "none"
  | "available"
  | "enabled"
  | "disabled"
  | "configuration_required"
  | "invalid";

export type PluginToolsView = {
  state: PluginToolState;
  serverCount: number;
  allowedToolCount: number;
  mode: "observe" | null;
  reason?: string;
};

export type PluginRuntimeView = PluginView & {
  tools: PluginToolsView;
};

type ResolvedServer = {
  connector: ConnectorConfig | null;
  blocker?: string;
};

export type PluginActivationResult = {
  plugins: PluginRuntimeView[];
  connectorIds: string[];
};

export class PluginRuntimeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

async function containedRealPath(root: string, value: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const canonicalCandidate = await realpath(path.resolve(canonicalRoot, value));
  if (!isContained(canonicalRoot, canonicalCandidate)) {
    throw new PluginRuntimeError(422, `Plugin path escapes its bundle: ${value}`);
  }
  return canonicalCandidate;
}

async function resolvedCommand(root: string, command: string): Promise<string> {
  if (path.isAbsolute(command)) return command;
  if (command.startsWith(".") || command.includes(path.sep)) {
    return containedRealPath(root, command);
  }
  return command;
}

async function resolvedArg(root: string, value: string): Promise<string> {
  return value.startsWith(".") ? containedRealPath(root, value) : value;
}

function connectorId(pluginId: string, serverId: string): string {
  const base = `plugin-${pluginId}-${serverId}`.toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
  if (base.length <= 64) return base;
  const digest = createHash("sha256").update(base).digest("hex").slice(0, 8);
  return `${base.slice(0, 55)}-${digest}`;
}

async function resolvedServer(
  bundle: PluginBundle,
  serverId: string,
  input: unknown,
): Promise<ResolvedServer> {
  const server = Schema.decodeUnknownSync(McpServerSchema)(input);
  const origin = {
    kind: "plugin",
    id: bundle.plugin.id,
    version: bundle.plugin.version,
    binding: serverId,
  };
  const id = connectorId(bundle.plugin.id, serverId);
  const name =
    serverId === bundle.plugin.id
      ? bundle.plugin.displayName
      : `${bundle.plugin.displayName}: ${serverId}`;

  if ("command" in server) {
    const root = await realpath(bundle.rootDir);
    const args = await Promise.all((server.args ?? []).map((value) => resolvedArg(root, value)));
    return {
      connector: {
        id,
        name,
        transport: "stdio",
        command: await resolvedCommand(root, server.command),
        args,
        env: { ...(server.env ?? {}) },
        cwd: await containedRealPath(root, server.cwd ?? "."),
        origin,
        enabled: false,
      },
    };
  }

  if (server.oauth_resource) return { connector: null, blocker: "OAuth connection required" };
  const bearerEnv = server.bearer_token_env_var;
  const bearerToken = bearerEnv ? process.env[bearerEnv]?.trim() : undefined;
  if (bearerEnv && !bearerToken) return { connector: null, blocker: `Set ${bearerEnv}` };
  return {
    connector: {
      id,
      name,
      transport: "http",
      url: server.url,
      headers: {
        ...(server.headers ?? {}),
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      origin,
      enabled: false,
    },
  };
}

function loadPluginServers(
  bundle: PluginBundle,
): Effect.Effect<ResolvedServer[], PluginRuntimeError> {
  if (!bundle.manifest.mcpServers) return Effect.succeed([]);
  return Effect.tryPromise({
    try: async () => {
      const manifestPath = await containedRealPath(
        bundle.rootDir,
        bundle.manifest.mcpServers ?? "",
      );
      const manifest = Schema.decodeUnknownSync(McpManifestSchema)(
        JSON.parse(await readFile(manifestPath, "utf8")),
      );
      return Promise.all(
        Object.entries(manifest.mcpServers).map(([serverId, server]) =>
          resolvedServer(bundle, serverId, server),
        ),
      );
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(
            422,
            `Invalid MCP manifest for ${bundle.plugin.displayName}: ${error}`,
          ),
  });
}

function pluginToolsView(
  bundle: PluginBundle,
  connectors: ConnectorConfig[],
  servers: ResolvedServer[],
): PluginToolsView {
  if (!bundle.manifest.mcpServers) {
    return { state: "none", serverCount: 0, allowedToolCount: 0, mode: null };
  }
  const current = connectors.filter(
    (connector) =>
      connector.origin?.kind === "plugin" &&
      connector.origin.id === bundle.plugin.id &&
      connector.origin.version === bundle.plugin.version,
  );
  const enabled = current.filter((connector) => connector.enabled);
  const blockers = [
    ...new Set(servers.flatMap((server) => (server.blocker ? [server.blocker] : []))),
  ];
  const installable = servers.filter((server) => server.connector !== null);
  const allowedToolCount = enabled.reduce(
    (count, connector) => count + (connector.allowTools?.length ?? 0),
    0,
  );
  if (enabled.length > 0) {
    return {
      state: "enabled",
      serverCount: servers.length,
      allowedToolCount,
      mode: "observe",
    };
  }
  if (current.length > 0) {
    return {
      state: "disabled",
      serverCount: servers.length,
      allowedToolCount: 0,
      mode: "observe",
    };
  }
  if (installable.length > 0) {
    return {
      state: "available",
      serverCount: servers.length,
      allowedToolCount: 0,
      mode: "observe",
      ...(blockers.length ? { reason: blockers.join(" · ") } : {}),
    };
  }
  return {
    state: "configuration_required",
    serverCount: servers.length,
    allowedToolCount: 0,
    mode: null,
    reason: blockers.join(" · ") || "No executable MCP server",
  };
}

function runtimeView(
  bundle: PluginBundle,
  connectors: ConnectorConfig[],
): Effect.Effect<PluginRuntimeView> {
  return Effect.match(loadPluginServers(bundle), {
    onFailure: (error) => ({
      ...bundle.plugin,
      tools: {
        state: "invalid" as const,
        serverCount: 0,
        allowedToolCount: 0,
        mode: null,
        reason: error.message,
      },
    }),
    onSuccess: (servers) => ({
      ...bundle.plugin,
      tools: pluginToolsView(bundle, connectors, servers),
    }),
  });
}

function connectorsEffect(): Effect.Effect<ConnectorConfig[], PluginRuntimeError> {
  return Effect.tryPromise({
    try: listConnectors,
    catch: (error) => new PluginRuntimeError(500, `Failed to read connector state: ${error}`),
  });
}

export function listPluginRuntimeViews(
  sources?: PluginSource[],
): Effect.Effect<PluginRuntimeView[], PluginRuntimeError> {
  return Effect.gen(function* () {
    const bundles = yield* discoverPluginBundles(sources).pipe(
      Effect.mapError((error) => new PluginRuntimeError(500, error.message)),
    );
    const connectors = yield* connectorsEffect();
    return yield* Effect.all(bundles.map((bundle) => runtimeView(bundle, connectors)));
  });
}

function enabledObserveConnectors(
  servers: ResolvedServer[],
): Effect.Effect<ConnectorConfig[], PluginRuntimeError> {
  const connectors = servers.flatMap((server) => (server.connector ? [server.connector] : []));
  return Effect.tryPromise({
    try: async () => {
      const probed = await Promise.all(
        connectors.map(async (connector) => ({
          connector,
          probe: await probeConnector(connector),
        })),
      );
      return probed.map(({ connector, probe }) => {
        if (!probe.ok) {
          throw new PluginRuntimeError(
            502,
            `${connector.name} failed to start: ${probe.error ?? "MCP probe failed"}`,
          );
        }
        const allowTools = probe.tools
          .filter((tool) => tool.annotations?.readOnlyHint === true)
          .map((tool) => tool.name);
        if (allowTools.length === 0) {
          throw new PluginRuntimeError(
            409,
            `${connector.name} does not declare any read-only tools`,
          );
        }
        return { ...connector, allowTools, enabled: true };
      });
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(502, `Plugin probe failed: ${error}`),
  });
}

export function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
  sources?: PluginSource[],
): Effect.Effect<PluginActivationResult, PluginRuntimeError> {
  return Effect.gen(function* () {
    const bundles = yield* discoverPluginBundles(sources).pipe(
      Effect.mapError((error) => new PluginRuntimeError(500, error.message)),
    );
    const bundle = bundles.find((candidate) => candidate.plugin.id === pluginId);
    if (!bundle) return yield* Effect.fail(new PluginRuntimeError(404, "Plugin not found"));
    const current = yield* connectorsEffect();
    const owned = current.filter(
      (connector) => connector.origin?.kind === "plugin" && connector.origin.id === pluginId,
    );
    let changed: ConnectorConfig[];
    if (enabled) {
      const servers = yield* loadPluginServers(bundle);
      const installable = servers.filter((server) => server.connector !== null);
      if (installable.length === 0) {
        const reason = servers.find((server) => server.blocker)?.blocker;
        return yield* Effect.fail(
          new PluginRuntimeError(409, reason ?? "Plugin has no executable MCP server"),
        );
      }
      changed = yield* enabledObserveConnectors(servers);
    } else {
      if (owned.length === 0) {
        return {
          plugins: yield* listPluginRuntimeViews(sources),
          connectorIds: [],
        };
      }
      changed = owned.map((connector) => ({ ...connector, enabled: false }));
    }
    yield* Effect.tryPromise({
      try: () => upsertConnectors(changed),
      catch: (error) => new PluginRuntimeError(500, `Failed to save plugin state: ${error}`),
    });
    return {
      plugins: yield* listPluginRuntimeViews(sources),
      connectorIds: changed.map((connector) => connector.id),
    };
  });
}
