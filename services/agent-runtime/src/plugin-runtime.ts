import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Effect, Schema } from "effect";
import { closePooledConnection, probeConnector } from "./connector-pool";
import {
  connectorsByOrigin,
  listConnectors,
  upsertConnectors,
  type ConnectorConfig,
} from "./connectors-service";
import { getGoogleAccount, type GoogleAccountView } from "./google-account";
import {
  disableGoogleWorkspaceAdapter,
  enableGoogleWorkspaceAdapter,
  trustedGoogleWorkspacePlugin,
  type GoogleWorkspacePluginId,
} from "./google-workspace-adapter";
import { discoverPluginBundles, type PluginBundle, type PluginSource } from "./plugin-discovery";
import {
  type PluginActivationResult,
  type PluginRuntimeView,
  type PluginHostCapability,
  type PluginToolsView,
  type PluginToolState,
} from "./plugin-runtime-contract";

export {
  type PluginActivationResult,
  type PluginRuntimeView,
  type PluginHostCapability,
  type PluginToolsView,
  type PluginToolState,
} from "./plugin-runtime-contract";

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

const SpeechHostBindingSchema = Schema.Struct({
  adapter: Schema.Literal("local-studio-controller"),
  capability: Schema.Literal("speech"),
  actions: Schema.Array(Schema.Literal("synthesize")),
});

const AppManifestSchema = Schema.Struct({
  apps: Schema.Record(Schema.String, Schema.Unknown),
});

type ResolvedServer = {
  connector: ConnectorConfig | null;
  blocker?: string;
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

function loadHostCapability(
  bundle: PluginBundle,
): Effect.Effect<PluginHostCapability | null, PluginRuntimeError> {
  if (!bundle.trusted || bundle.plugin.id !== "chatterbox-voice" || !bundle.manifest.apps) {
    return Effect.succeed(null);
  }
  return Effect.tryPromise({
    try: async () => {
      const manifestPath = await containedRealPath(bundle.rootDir, bundle.manifest.apps ?? "");
      const manifest = Schema.decodeUnknownSync(AppManifestSchema)(
        JSON.parse(await readFile(manifestPath, "utf8")),
      );
      const binding = Schema.decodeUnknownSync(SpeechHostBindingSchema)(
        manifest.apps["chatterbox-voice"],
      );
      if (binding.actions.length !== 1) {
        throw new PluginRuntimeError(422, "Chatterbox Voice action contract changed");
      }
      return binding;
    },
    catch: (error) =>
      error instanceof PluginRuntimeError
        ? error
        : new PluginRuntimeError(422, `Invalid Chatterbox Voice manifest: ${error}`),
  });
}

function observedToolsView(input: {
  current: ConnectorConfig[];
  serverCount: number;
  available: boolean;
  blockedReason?: string;
  invalidReason?: string;
  availableReason?: string;
  unavailableReason?: string;
}): PluginToolsView {
  const enabled = input.current.filter((connector) => connector.enabled);
  const allowedToolCount = enabled.reduce(
    (count, connector) => count + (connector.allowTools?.length ?? 0),
    0,
  );
  if (input.blockedReason) {
    return {
      state: "configuration_required",
      serverCount: input.serverCount,
      allowedToolCount: 0,
      mode: null,
      reason: input.blockedReason,
    };
  }
  if (enabled.length) {
    return { state: "enabled", serverCount: input.serverCount, allowedToolCount, mode: "observe" };
  }
  if (input.invalidReason) {
    return {
      state: "invalid",
      serverCount: input.serverCount,
      allowedToolCount: 0,
      mode: null,
      reason: input.invalidReason,
    };
  }
  if (input.current.length) {
    return {
      state: "disabled",
      serverCount: input.serverCount,
      allowedToolCount: 0,
      mode: "observe",
    };
  }
  return input.available
    ? {
        state: "available",
        serverCount: input.serverCount,
        allowedToolCount: 0,
        mode: "observe",
        ...(input.availableReason ? { reason: input.availableReason } : {}),
      }
    : {
        state: "configuration_required",
        serverCount: input.serverCount,
        allowedToolCount: 0,
        mode: null,
        reason: input.unavailableReason ?? "No executable MCP server",
      };
}

function pluginToolsView(
  bundle: PluginBundle,
  connectors: ConnectorConfig[],
  servers: ResolvedServer[],
  reconciliationError?: string,
): PluginToolsView {
  if (!bundle.manifest.mcpServers) {
    return { state: "none", serverCount: 0, allowedToolCount: 0, mode: null };
  }
  const current = connectorsByOrigin(connectors, {
    kind: "plugin",
    id: bundle.plugin.id,
    version: bundle.plugin.version,
  });
  const blockers = [
    ...new Set(servers.flatMap((server) => (server.blocker ? [server.blocker] : []))),
  ];
  const reason = blockers.join(" · ");
  return observedToolsView({
    current,
    serverCount: servers.length,
    available: servers.some((server) => server.connector !== null),
    invalidReason: reconciliationError,
    availableReason: reason || undefined,
    unavailableReason: reason || undefined,
  });
}

function googleWorkspaceRuntimeView(
  bundle: PluginBundle,
  id: GoogleWorkspacePluginId,
  connectors: ConnectorConfig[],
  account: GoogleAccountView,
): PluginRuntimeView {
  const connection = account.connections[id];
  const current = connectorsByOrigin(connectors, {
    kind: "account-adapter",
    id,
    binding: "google-workspace",
  });
  const reason = !account.configured
    ? "Add a Google Desktop OAuth client"
    : !connection.connected
      ? "Finish Google sign-in"
      : undefined;
  return {
    ...bundle.plugin,
    account: {
      provider: "google",
      id,
      configured: account.configured,
      connected: connection.connected,
      email: connection.email,
    },
    tools: observedToolsView({
      current,
      serverCount: 1,
      available: connection.connected,
      blockedReason: reason,
    }),
  };
}

function runtimeView(
  bundle: PluginBundle,
  connectors: ConnectorConfig[],
  account: GoogleAccountView,
  reconciliationError?: string,
): Effect.Effect<PluginRuntimeView, PluginRuntimeError> {
  return Effect.gen(function* () {
    const googleWorkspace = yield* trustedGoogleWorkspacePlugin(bundle);
    if (googleWorkspace) {
      const view = googleWorkspaceRuntimeView(bundle, googleWorkspace, connectors, account);
      const current = connectorsByOrigin(connectors, {
        kind: "account-adapter",
        id: googleWorkspace,
        binding: "google-workspace",
      });
      return yield* runtimeHealthView(view, current);
    }
    const hostCapability = yield* loadHostCapability(bundle);
    if (hostCapability) {
      return {
        ...bundle.plugin,
        hostCapability,
        tools: { state: "none", serverCount: 0, allowedToolCount: 0, mode: null },
      };
    }
    return yield* Effect.matchEffect(loadPluginServers(bundle), {
      onFailure: (error) =>
        Effect.succeed({
          ...bundle.plugin,
          tools: {
            state: "invalid" as const,
            serverCount: 0,
            allowedToolCount: 0,
            mode: null,
            reason: error.message,
          },
        }),
      onSuccess: (servers) => {
        const current = connectorsByOrigin(connectors, {
          kind: "plugin",
          id: bundle.plugin.id,
          version: bundle.plugin.version,
        });
        return runtimeHealthView(
          {
            ...bundle.plugin,
            tools: pluginToolsView(bundle, connectors, servers, reconciliationError),
          },
          current,
        );
      },
    });
  });
}

function runtimeHealthView(
  view: PluginRuntimeView,
  connectors: ConnectorConfig[],
): Effect.Effect<PluginRuntimeView> {
  if (view.tools.state !== "enabled") return Effect.succeed(view);
  return Effect.promise(() =>
    Promise.all(connectors.map((connector) => probeConnector(connector))),
  ).pipe(
    Effect.map((probes) => {
      const failures = probes.flatMap((probe, index) =>
        probe.ok ? [] : [`${connectors[index]?.name}: ${probe.error ?? "MCP probe failed"}`],
      );
      return failures.length
        ? {
            ...view,
            tools: { ...view.tools, state: "invalid" as const, reason: failures.join(" · ") },
          }
        : view;
    }),
  );
}

type ConnectorReconciliation = {
  connectors: ConnectorConfig[];
  errors: Map<string, string>;
};

async function reconcileEnabledPluginConnectors(
  bundles: PluginBundle[],
  initial: ConnectorConfig[],
): Promise<ConnectorReconciliation> {
  let connectors = initial;
  const errors = new Map<string, string>();
  for (const bundle of bundles) {
    const stale = connectorsByOrigin(connectors, {
      kind: "plugin",
      id: bundle.plugin.id,
    }).filter(
      (connector) => connector.enabled && connector.origin?.version !== bundle.plugin.version,
    );
    if (stale.length === 0) continue;
    try {
      const servers = await Effect.runPromise(loadPluginServers(bundle));
      const replacements = stale.map((connector) => {
        const replacement = servers.find(
          (server) => server.connector?.origin?.binding === connector.origin?.binding,
        )?.connector;
        if (!replacement || !connector.allowTools?.length) {
          throw new PluginRuntimeError(409, "Reconnect to approve the updated plugin");
        }
        return { ...replacement, allowTools: connector.allowTools, enabled: true };
      });
      const updated = await Effect.runPromise(enabledObserveConnectors(replacements));
      connectors = await upsertConnectors(updated);
      updated.forEach((connector) => closePooledConnection(connector.id));
    } catch (error) {
      errors.set(bundle.plugin.id, error instanceof Error ? error.message : "Plugin update failed");
    }
  }
  return { connectors, errors };
}

function connectorReconciliationEffect(
  bundles: PluginBundle[],
): Effect.Effect<ConnectorReconciliation, PluginRuntimeError> {
  return Effect.gen(function* () {
    const initial = yield* connectorsEffect();
    return yield* Effect.tryPromise({
      try: () => reconcileEnabledPluginConnectors(bundles, initial),
      catch: (error) => new PluginRuntimeError(500, `Plugin reconciliation failed: ${error}`),
    });
  });
}

export function refreshEnabledPluginConnectors(
  sources?: PluginSource[],
): Effect.Effect<void, PluginRuntimeError> {
  return Effect.gen(function* () {
    const bundles = yield* discoverPluginBundles(sources).pipe(
      Effect.mapError((error) => new PluginRuntimeError(500, error.message)),
    );
    yield* connectorReconciliationEffect(bundles);
  });
}

function connectorsEffect(): Effect.Effect<ConnectorConfig[], PluginRuntimeError> {
  return Effect.tryPromise({
    try: listConnectors,
    catch: (error) => new PluginRuntimeError(500, `Failed to read connector state: ${error}`),
  });
}

function googleAccountEffect(): Effect.Effect<GoogleAccountView, PluginRuntimeError> {
  return getGoogleAccount().pipe(
    Effect.mapError(
      (error) => new PluginRuntimeError(error.status, `Google account failed: ${error.message}`),
    ),
  );
}

function pluginActivationResult(
  sources: PluginSource[] | undefined,
  connectorIds: string[],
): Effect.Effect<PluginActivationResult, PluginRuntimeError> {
  return listPluginRuntimeViews(sources).pipe(Effect.map((plugins) => ({ plugins, connectorIds })));
}

export function listPluginRuntimeViews(
  sources?: PluginSource[],
): Effect.Effect<PluginRuntimeView[], PluginRuntimeError> {
  return Effect.gen(function* () {
    const bundles = yield* discoverPluginBundles(sources).pipe(
      Effect.mapError((error) => new PluginRuntimeError(500, error.message)),
    );
    const reconciliation = yield* connectorReconciliationEffect(bundles);
    const account = yield* googleAccountEffect();
    return yield* Effect.all(
      bundles.map((bundle) =>
        runtimeView(
          bundle,
          reconciliation.connectors,
          account,
          reconciliation.errors.get(bundle.plugin.id),
        ),
      ),
    );
  });
}

function enabledObserveConnectors(
  connectors: ConnectorConfig[],
): Effect.Effect<ConnectorConfig[], PluginRuntimeError> {
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
        const requested = connector.allowTools ? new Set(connector.allowTools) : null;
        const allowTools = probe.tools
          .filter(
            (tool) =>
              tool.annotations?.readOnlyHint === true && (!requested || requested.has(tool.name)),
          )
          .map((tool) => tool.name);
        if (allowTools.length === 0) {
          throw new PluginRuntimeError(
            409,
            `${connector.name} does not declare any read-only tools`,
          );
        }
        if (requested && allowTools.length !== requested.size) {
          throw new PluginRuntimeError(409, `${connector.name} read-only contract changed`);
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
    const googleWorkspace = yield* trustedGoogleWorkspacePlugin(bundle);
    if (googleWorkspace) {
      const account = yield* googleAccountEffect();
      if (!account.connections[googleWorkspace].connected) {
        return yield* Effect.fail(new PluginRuntimeError(409, "Finish Google sign-in first"));
      }
      const connectorIds = yield* (
        enabled
          ? enableGoogleWorkspaceAdapter(googleWorkspace)
          : disableGoogleWorkspaceAdapter(googleWorkspace)
      ).pipe(Effect.mapError((error) => new PluginRuntimeError(error.status, error.message)));
      return yield* pluginActivationResult(sources, connectorIds);
    }
    if (yield* loadHostCapability(bundle)) {
      return yield* pluginActivationResult(sources, []);
    }
    const owned = connectorsByOrigin(current, { kind: "plugin", id: pluginId });
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
      changed = yield* enabledObserveConnectors(
        servers.flatMap((server) => (server.connector ? [server.connector] : [])),
      );
    } else {
      if (owned.length === 0) {
        return yield* pluginActivationResult(sources, []);
      }
      changed = owned.map((connector) => ({ ...connector, enabled: false }));
    }
    yield* Effect.tryPromise({
      try: () => upsertConnectors(changed),
      catch: (error) => new PluginRuntimeError(500, `Failed to save plugin state: ${error}`),
    });
    return yield* pluginActivationResult(
      sources,
      changed.map((connector) => connector.id),
    );
  });
}
