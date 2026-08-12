import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { resolveDataDir } from "./data-dir";

const PROTOCOL_VERSION = 1 as const;
const SECRET_HEADER = "x-local-studio-litter-bridge-secret" as const;
const ROUTE_PATH = "/api/litter-bridge/v1";

const PiRuntimeSchema = Schema.Struct({
  program: Schema.String,
  args: Schema.Array(Schema.String),
  env: Schema.Record(Schema.String, Schema.String),
});

const RuntimeMetadataSchema = Schema.Struct({
  protocolVersion: Schema.Literal(PROTOCOL_VERSION),
  url: Schema.String,
  secretHeader: Schema.Literal(SECRET_HEADER),
  secret: Schema.String,
  controllerId: Schema.String,
  pid: Schema.Number,
  issuedAt: Schema.String,
  piAgentDir: Schema.String,
  piRuntime: Schema.optional(PiRuntimeSchema),
});

type PiRuntime = typeof PiRuntimeSchema.Type;
type RuntimeMetadata = typeof RuntimeMetadataSchema.Type;

const metadataPath = (dataDir: string): string => path.join(dataDir, "litter-bridge.json");
const controllerIdPath = (dataDir: string): string => path.join(dataDir, "litter-controller-id");

const writePrivateJson = (filepath: string, value: RuntimeMetadata): void => {
  const temporary = `${filepath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, filepath);
  chmodSync(filepath, 0o600);
};

const boundedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 512
    ? value
    : null;

const loadControllerId = (dataDir: string): string => {
  const filepath = controllerIdPath(dataDir);
  if (existsSync(filepath)) {
    try {
      const existing = readFileSync(filepath, "utf8").trim();
      if (boundedString(existing)) return existing;
    } catch {}
  }
  const created = randomUUID();
  const temporary = `${filepath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  writeFileSync(temporary, `${created}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, filepath);
  chmodSync(filepath, 0o600);
  return created;
};

const resolvePiAgentDir = (dataDir: string): string => {
  const explicit = process.env.PI_CODING_AGENT_DIR?.trim();
  return path.resolve(explicit || path.join(dataDir, "pi-agent"));
};

export const resolveElectronNodeExecutable = (
  execPath: string,
  pathExists: (candidate: string) => boolean = existsSync,
): string => {
  const executableName = path.basename(execPath);
  const contentsDir = path.dirname(path.dirname(execPath));
  const helperPath = path.join(
    contentsDir,
    "Frameworks",
    `${executableName} Helper.app`,
    "Contents",
    "MacOS",
    `${executableName} Helper`,
  );
  return pathExists(helperPath) ? helperPath : execPath;
};

export const resolvePackagedPiCli = (
  resourcesPath: string | undefined,
  pathExists: (candidate: string) => boolean = existsSync,
): string | null => {
  if (!resourcesPath?.trim()) return null;
  const cli = path.join(
    resourcesPath,
    "app",
    "frontend",
    ".next",
    "standalone",
    "frontend",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  return pathExists(cli) ? cli : null;
};

const resolvePiRuntime = (): PiRuntime | null => {
  let cli: string | null = null;
  try {
    cli = path.join(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "cli.js");
  } catch {}
  cli ??= resolvePackagedPiCli(
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
  );
  if (!cli) return null;
  const electron = Boolean(process.versions.electron);
  return {
    program:
      process.platform === "darwin" && electron
        ? resolveElectronNodeExecutable(process.execPath)
        : process.execPath,
    args: [cli],
    env: electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
  };
};

export function createLitterRuntimeMetadataPublisher() {
  const dataDir = resolveDataDir();
  const secret =
    process.env.LOCAL_STUDIO_LITTER_BRIDGE_SECRET?.trim() ??
    randomBytes(32).toString("base64url");
  if (secret.length < 32 || secret.length > 512) throw new Error("Invalid Litter metadata secret");
  const controllerId = loadControllerId(dataDir);
  let published: RuntimeMetadata | null = null;

  const publish = (port: number): void => {
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error("Invalid agent runtime port");
    }
    const piRuntime = resolvePiRuntime();
    published = Schema.decodeUnknownSync(RuntimeMetadataSchema)({
      protocolVersion: PROTOCOL_VERSION,
      url: `http://127.0.0.1:${port}${ROUTE_PATH}`,
      secretHeader: SECRET_HEADER,
      secret,
      controllerId,
      pid: process.pid,
      issuedAt: new Date().toISOString(),
      piAgentDir: resolvePiAgentDir(dataDir),
      ...(piRuntime ? { piRuntime } : {}),
    });
    writePrivateJson(metadataPath(dataDir), published);
  };

  const dispose = (): void => {
    if (!published) return;
    const filepath = metadataPath(dataDir);
    try {
      const current = Schema.decodeUnknownSync(RuntimeMetadataSchema)(
        JSON.parse(readFileSync(filepath, "utf8")),
      );
      if (current.pid === published.pid && current.secret === published.secret) rmSync(filepath);
    } catch {}
    published = null;
  };

  return { publish, dispose };
}
