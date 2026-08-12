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
import {
  GOOGLE_WORKSPACE_BINDINGS,
  isGoogleWorkspacePlugin,
  type GoogleWorkspacePluginId,
} from "./google-workspace-binding";
import type { PluginBundle } from "./plugin-discovery";

export { GOOGLE_WORKSPACE_PLUGIN_IDS, isGoogleWorkspacePlugin } from "./google-workspace-binding";
export type { GoogleWorkspacePluginId } from "./google-workspace-binding";

export class GoogleWorkspaceAdapterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function adapterEffect<A>(
  message: string,
  task: () => Promise<A>,
): Effect.Effect<A, GoogleWorkspaceAdapterError> {
  return Effect.tryPromise({
    try: task,
    catch: (error) =>
      error instanceof GoogleWorkspaceAdapterError
        ? error
        : new GoogleWorkspaceAdapterError(500, `${message}: ${error}`),
  });
}

const AppsSchema = Schema.Struct({ apps: Schema.Record(Schema.String, Schema.Unknown) });
const GoogleWorkspaceAppSchema = Schema.Struct({
  adapter: Schema.Literal("google-workspace"),
  mode: Schema.Literal("read-only"),
});

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export function trustedGoogleWorkspacePlugin(
  bundle: PluginBundle,
): Effect.Effect<GoogleWorkspacePluginId | null> {
  return Effect.promise(async () => {
    if (!bundle.trusted || !isGoogleWorkspacePlugin(bundle.plugin.id) || !bundle.manifest.apps) {
      return null;
    }
    try {
      const root = await realpath(bundle.rootDir);
      const file = await realpath(path.resolve(root, bundle.manifest.apps));
      if (!isContained(root, file)) return null;
      const manifest = Schema.decodeUnknownSync(AppsSchema)(
        JSON.parse(await readFile(file, "utf8")),
      );
      Schema.decodeUnknownSync(GoogleWorkspaceAppSchema)(manifest.apps[bundle.plugin.id]);
      return bundle.plugin.id;
    } catch {
      return null;
    }
  });
}

export function googleWorkspaceConnector(
  id: GoogleWorkspacePluginId,
  enabled: boolean,
): ConnectorConfig {
  const binding = GOOGLE_WORKSPACE_BINDINGS[id];
  return {
    id: binding.connectorId,
    name: binding.name,
    transport: "http",
    url: binding.endpoint,
    auth: { type: "oauth", provider: "google-workspace", account: id },
    allowTools: [...binding.observeTools],
    origin: { kind: "account-adapter", id, binding: "google-workspace" },
    enabled,
  };
}

export function enableGoogleWorkspaceAdapter(
  id: GoogleWorkspacePluginId,
  signal?: AbortSignal,
): Effect.Effect<string[], GoogleWorkspaceAdapterError> {
  return adapterEffect("Google Workspace adapter failed", async () => {
    const connector = googleWorkspaceConnector(id, false);
    const probe = await probeConnector(connector, signal);
    if (!probe.ok) {
      throw new GoogleWorkspaceAdapterError(
        502,
        `${connector.name} failed to start: ${probe.error ?? "MCP probe failed"}`,
      );
    }
    const declaredReadOnly = new Set(
      probe.tools
        .filter((tool) => tool.annotations?.readOnlyHint === true)
        .map((tool) => tool.name),
    );
    const allowTools = GOOGLE_WORKSPACE_BINDINGS[id].observeTools.filter((tool) =>
      declaredReadOnly.has(tool),
    );
    if (allowTools.length !== GOOGLE_WORKSPACE_BINDINGS[id].observeTools.length) {
      throw new GoogleWorkspaceAdapterError(409, `${connector.name} read-only contract changed`);
    }
    const enabled = { ...connector, enabled: true, allowTools };
    await upsertConnectors([enabled]);
    closePooledConnection(enabled.id);
    return [enabled.id];
  });
}

export function googleWorkspaceAdapterEnabled(
  id: GoogleWorkspacePluginId,
): Effect.Effect<boolean, GoogleWorkspaceAdapterError> {
  return adapterEffect("Google Workspace adapter state failed", async () =>
    connectorsByOrigin(await listConnectors(), {
      kind: "account-adapter",
      id,
      binding: "google-workspace",
    }).some((connector) => connector.enabled),
  );
}

export function restoreGoogleWorkspaceAdapter(
  id: GoogleWorkspacePluginId,
  enabled: boolean,
): Effect.Effect<string[], GoogleWorkspaceAdapterError> {
  return adapterEffect("Google Workspace adapter restore failed", async () => {
    const current = await listConnectors();
    const owned = connectorsByOrigin(current, {
      kind: "account-adapter",
      id,
      binding: "google-workspace",
    });
    const changed = owned.length || enabled ? [googleWorkspaceConnector(id, enabled)] : [];
    if (changed.length > 0) await upsertConnectors(changed);
    closePooledConnection(GOOGLE_WORKSPACE_BINDINGS[id].connectorId);
    return changed.map((connector) => connector.id);
  });
}

export function disableGoogleWorkspaceAdapter(
  id: GoogleWorkspacePluginId,
): Effect.Effect<string[], GoogleWorkspaceAdapterError> {
  return adapterEffect("Google Workspace disconnect failed", async () => {
    const current = await listConnectors();
    const owned = connectorsByOrigin(current, {
      kind: "account-adapter",
      id,
      binding: "google-workspace",
    });
    const disabled = owned.map((connector) => ({ ...connector, enabled: false }));
    if (disabled.length) await upsertConnectors(disabled);
    owned.forEach((connector) => closePooledConnection(connector.id));
    return disabled.map((connector) => connector.id);
  });
}
