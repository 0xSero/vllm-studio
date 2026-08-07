import { randomUUID } from "node:crypto";
import { chmod, lstat, readFile, rename, unlink, writeFile } from "fs/promises";
import { existsSync, readFileSync, statSync, type Stats } from "fs";
import { join } from "path";
import { resolveDataDir } from "./data-dir";
import { Effect, Schema } from "effect";
import {
  CONNECTOR_MASK_TOKEN,
  ConnectorConfigSchema,
  ConnectorUpsertInputSchema,
  ConnectorsFileSchema,
  type ConnectorConfig,
  type ConnectorUpsertInput,
  type ConnectorView,
} from "./connector-contract";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  googleWorkspaceConnectorAccount,
} from "./google-workspace-binding";

export {
  type ConnectorAuthReference,
  type ConnectorConfig,
  type ConnectorOrigin,
  type ConnectorView,
} from "./connector-contract";

export type ConnectorFileSystem = {
  readonly chmod: (path: string, mode: number) => Promise<void>;
  readonly lstat: (path: string) => Promise<Stats>;
  readonly rename: (source: string, destination: string) => Promise<void>;
  readonly unlink: (path: string) => Promise<void>;
  readonly writeFile: (
    path: string,
    data: string,
    options: { readonly encoding: "utf-8"; readonly flag: "wx"; readonly mode: number },
  ) => Promise<void>;
};

export type ConnectorPersistenceOptions = {
  readonly fileSystem?: ConnectorFileSystem;
  readonly identity?: ConnectorPersistenceIdentity;
  readonly windowsSecurity?: ConnectorWindowsSecurity;
};

export type ConnectorPersistenceIdentity = {
  readonly platform: NodeJS.Platform;
  readonly uid: number | undefined;
};

export type ConnectorWindowsSecurity = {
  readonly protect: (path: string, kind: "directory" | "file") => Promise<void>;
  readonly verify: (path: string, kind: "directory" | "file") => Promise<void>;
};

const CONNECTOR_CONFIGURATION_ERROR = "Connector configuration is invalid";
const exact = { onExcessProperty: "error" } as const;
const decodeRawConnector = Schema.decodeUnknownSync(ConnectorConfigSchema, exact);
const decodeUpsertInput = Schema.decodeUnknownSync(ConnectorUpsertInputSchema, exact);
const defaultConnectorFileSystem: ConnectorFileSystem = {
  chmod,
  lstat,
  rename,
  unlink,
  writeFile,
};
let connectorAccess = Promise.resolve();

export class ConnectorConfigurationError extends Error {
  readonly status = 409;

  constructor() {
    super(CONNECTOR_CONFIGURATION_ERROR);
    this.name = "ConnectorConfigurationError";
  }
}

function configurationError(): ConnectorConfigurationError {
  return new ConnectorConfigurationError();
}

function validatedRawConnectors(incoming: readonly ConnectorConfig[]): ConnectorConfig[] {
  try {
    return incoming.map((connector) => decodeRawConnector(connector));
  } catch {
    throw configurationError();
  }
}

function withConnectorAccess<A>(operation: () => Promise<A>): Promise<A> {
  const result = connectorAccess.then(operation);
  connectorAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function claimsGoogleWorkspace(connector: ConnectorConfig): boolean {
  return (
    googleWorkspaceConnectorAccount(connector.id) !== null ||
    connector.auth?.provider === "google-workspace" ||
    connector.origin?.binding === "google-workspace"
  );
}

export function protectManagedConnector(connector: ConnectorConfig): ConnectorConfig {
  if (!claimsGoogleWorkspace(connector)) return connector;
  const account = googleWorkspaceConnectorAccount(connector.id);
  const binding = account ? GOOGLE_WORKSPACE_BINDINGS[account] : null;
  const valid =
    account !== null &&
    binding !== null &&
    connector.transport === "http" &&
    connector.url === binding.endpoint &&
    connector.auth?.type === "oauth" &&
    connector.auth.provider === "google-workspace" &&
    connector.auth.account === account &&
    connector.origin?.kind === "account-adapter" &&
    connector.origin.id === account &&
    connector.origin.binding === "google-workspace" &&
    !connector.command &&
    !connector.cwd &&
    !connector.args?.length &&
    !connector.env &&
    !connector.headers &&
    connector.allowTools?.length === binding?.observeTools.length &&
    binding?.observeTools.every((tool, index) => connector.allowTools?.[index] === tool);
  if (!valid || !account || !binding) {
    throw new Error(`Managed Google Workspace connector "${connector.id}" is immutable`);
  }
  return {
    id: binding.connectorId,
    name: binding.name,
    transport: "http",
    url: binding.endpoint,
    auth: { type: "oauth", provider: "google-workspace", account },
    allowTools: [...binding.observeTools],
    origin: { kind: "account-adapter", id: account, binding: "google-workspace" },
    enabled: connector.enabled,
  };
}

export function resolveConnectorsFilePath(): string {
  return join(resolveDataDir(), "connectors.json");
}

const CONNECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export const isValidConnectorId = (id: string): boolean => CONNECTOR_ID_PATTERN.test(id);

export async function listConnectors(): Promise<ConnectorConfig[]> {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return [];
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema, exact)(
      JSON.parse(await readFile(file, "utf-8")),
    );
    return (parsed.connectors ?? []).map(protectManagedConnector);
  } catch {
    throw configurationError();
  }
}

function fileOperation<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({ try: operation, catch: (error) => error });
}

function verifyPathKind(metadata: Stats, kind: "directory" | "file"): void {
  const validKind = kind === "directory" ? metadata.isDirectory() : metadata.isFile();
  if (!validKind || metadata.isSymbolicLink()) {
    throw new Error(`Connector ${kind} is unsafe`);
  }
}

function verifyOwnerOnly(
  initial: Stats,
  metadata: Stats,
  kind: "directory" | "file",
  mode: number,
  uid: number,
): void {
  verifyStablePath(initial, metadata, kind);
  if (metadata.uid !== uid || (metadata.mode & 0o777) !== mode) {
    throw new Error(`Connector ${kind} permissions are unsafe`);
  }
}

function verifyStablePath(initial: Stats, metadata: Stats, kind: "directory" | "file"): void {
  verifyPathKind(metadata, kind);
  if (initial.dev !== metadata.dev || initial.ino !== metadata.ino) {
    throw new Error(`Connector ${kind} changed during permission enforcement`);
  }
}

function enforceOwnerOnly(
  fileSystem: ConnectorFileSystem,
  path: string,
  kind: "directory" | "file",
  mode: number,
  identity: ConnectorPersistenceIdentity,
  windowsSecurity: ConnectorWindowsSecurity | undefined,
) {
  return Effect.gen(function* () {
    const initial = yield* fileOperation(() => fileSystem.lstat(path));
    yield* Effect.try({
      try: () => verifyPathKind(initial, kind),
      catch: (error) => error,
    });
    if (identity.platform === "win32") {
      if (!windowsSecurity) {
        return yield* Effect.fail(
          new Error("Connector owner-only ACL enforcement is unavailable on Windows"),
        );
      }
      yield* fileOperation(() => windowsSecurity.protect(path, kind));
      yield* fileOperation(() => windowsSecurity.verify(path, kind));
      const metadata = yield* fileOperation(() => fileSystem.lstat(path));
      return yield* Effect.try({
        try: () => verifyStablePath(initial, metadata, kind),
        catch: (error) => error,
      });
    }
    const uid = identity.uid;
    if (uid === undefined) {
      return yield* Effect.fail(new Error("Connector ownership verifier is unavailable"));
    }
    yield* fileOperation(() => fileSystem.chmod(path, mode));
    const metadata = yield* fileOperation(() => fileSystem.lstat(path));
    yield* Effect.try({
      try: () => verifyOwnerOnly(initial, metadata, kind, mode, uid),
      catch: (error) => error,
    });
  });
}

function writeConnectorPayload(
  payload: string,
  fileSystem: ConnectorFileSystem,
  identity: ConnectorPersistenceIdentity,
  windowsSecurity: ConnectorWindowsSecurity | undefined,
) {
  return Effect.gen(function* () {
    const dataDirectory = yield* Effect.try({
      try: resolveDataDir,
      catch: (error) => error,
    });
    yield* enforceOwnerOnly(
      fileSystem,
      dataDirectory,
      "directory",
      0o700,
      identity,
      windowsSecurity,
    );
    const file = join(dataDirectory, "connectors.json");
    const tempFile = `${file}.tmp-${process.pid}-${randomUUID()}`;
    yield* Effect.acquireUseRelease(
      Effect.succeed(tempFile),
      (temporary) =>
        Effect.gen(function* () {
          yield* fileOperation(() =>
            fileSystem.writeFile(temporary, payload, {
              encoding: "utf-8",
              flag: "wx",
              mode: 0o600,
            }),
          );
          yield* enforceOwnerOnly(fileSystem, temporary, "file", 0o600, identity, windowsSecurity);
          yield* fileOperation(() => fileSystem.rename(temporary, file));
        }),
      (temporary) => fileOperation(() => fileSystem.unlink(temporary)).pipe(Effect.ignore),
    );
  });
}

function writeConnectors(
  connectors: ConnectorConfig[],
  options: ConnectorPersistenceOptions = {},
): Promise<void> {
  let configuration: typeof ConnectorsFileSchema.Type;
  try {
    configuration = Schema.decodeUnknownSync(ConnectorsFileSchema, exact)({
      connectors: connectors.map(protectManagedConnector),
    });
  } catch {
    throw configurationError();
  }
  const payload = JSON.stringify(configuration, null, 2);
  return Effect.runPromise(
    writeConnectorPayload(
      payload,
      options.fileSystem ?? defaultConnectorFileSystem,
      options.identity ?? {
        platform: process.platform,
        uid: process.getuid?.(),
      },
      options.windowsSecurity,
    ),
  );
}

export function saveConnectors(
  connectors: ConnectorConfig[],
  options: ConnectorPersistenceOptions = {},
): Promise<void> {
  return withConnectorAccess(() => writeConnectors(connectors, options));
}

export async function upsertConnector(connector: ConnectorConfig): Promise<ConnectorConfig[]> {
  return upsertConnectors([connector]);
}

export function upsertConnectors(incoming: ConnectorConfig[]): Promise<ConnectorConfig[]> {
  return persistIncomingConnectors(incoming, false);
}

export function upsertConnectorInput(input: ConnectorUpsertInput): Promise<ConnectorConfig[]> {
  let body: ConnectorUpsertInput;
  try {
    body = decodeUpsertInput(input);
  } catch {
    return Promise.reject(configurationError());
  }
  const connector: ConnectorConfig = {
    id: body.id,
    name: body.name?.trim() || body.id,
    transport: body.transport,
    ...(body.command ? { command: body.command } : {}),
    ...(body.args ? { args: body.args } : {}),
    ...(body.env ? { env: body.env } : {}),
    ...(body.cwd ? { cwd: body.cwd } : {}),
    ...(body.url ? { url: body.url } : {}),
    ...(body.headers ? { headers: body.headers } : {}),
    ...(body.allowTools ? { allowTools: body.allowTools } : {}),
    enabled: body.enabled ?? true,
  };
  return persistIncomingConnectors([connector], true);
}

function persistIncomingConnectors(
  incoming: ConnectorConfig[],
  preserveMaskedSecrets: boolean,
): Promise<ConnectorConfig[]> {
  return withConnectorAccess(async () => {
    const candidates = preserveMaskedSecrets ? incoming : validatedRawConnectors(incoming);
    const connectors = await listConnectors();
    for (const candidate of candidates) {
      const index = connectors.findIndex((entry) => entry.id === candidate.id);
      const existing = index === -1 ? null : connectors[index];
      let connector: ConnectorConfig;
      try {
        connector = protectManagedConnector(
          decodeRawConnector({
            ...candidate,
            env: preserveMaskedSecrets
              ? mergeSecrets(candidate.env, existing?.env)
              : candidate.env,
            headers: preserveMaskedSecrets
              ? mergeSecrets(candidate.headers, existing?.headers)
              : candidate.headers,
            cwd: candidate.cwd ?? existing?.cwd,
            allowTools: candidate.allowTools ?? existing?.allowTools,
            origin: candidate.origin ?? existing?.origin,
            auth: candidate.auth ?? existing?.auth,
          }),
        );
      } catch (error) {
        if (error instanceof ConnectorConfigurationError) throw error;
        throw configurationError();
      }
      if (index === -1) connectors.push(connector);
      else connectors[index] = connector;
    }
    await writeConnectors(connectors);
    return connectors;
  });
}

export function removeConnector(id: string): Promise<ConnectorConfig[]> {
  if (googleWorkspaceConnectorAccount(id)) {
    return Promise.reject(
      new Error(`Managed Google Workspace connector "${id}" cannot be removed`),
    );
  }
  return withConnectorAccess(async () => {
    const connectors = (await listConnectors()).filter((entry) => entry.id !== id);
    await writeConnectors(connectors);
    return connectors;
  });
}

function mergeSecrets(
  incoming: Record<string, string> | undefined,
  stored: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return incoming;
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== CONNECTOR_MASK_TOKEN) {
      result[key] = value;
      continue;
    }
    if (!stored || !Object.hasOwn(stored, key)) throw configurationError();
    const storedValue = stored[key];
    if (storedValue === undefined) throw configurationError();
    result[key] = storedValue;
  }
  return result;
}

const maskRecord = (
  record: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!record) return record;
  return Object.fromEntries(Object.keys(record).map((key) => [key, CONNECTOR_MASK_TOKEN]));
};

export function toConnectorView(connector: ConnectorConfig): ConnectorView {
  return {
    ...connector,
    env: maskRecord(connector.env),
    headers: maskRecord(connector.headers),
    secret_keys: {
      env: Object.keys(connector.env ?? {}).sort(),
      headers: Object.keys(connector.headers ?? {}).sort(),
    },
  };
}

export async function enabledConnectors(): Promise<ConnectorConfig[]> {
  return (await listConnectors()).filter((connector) => connector.enabled);
}

export function hasEnabledConnectorsSync(): boolean {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return false;
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema, exact)(
      JSON.parse(readFileSync(file, "utf-8")),
    );
    return Boolean(parsed.connectors?.some((connector) => connector.enabled));
  } catch {
    return false;
  }
}

export function connectorsRevisionSync(): string {
  const file = resolveConnectorsFilePath();
  try {
    const info = statSync(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "none";
  }
}
