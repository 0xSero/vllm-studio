import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDataDir } from "./data-dir";

const SECRET_HEADER = "x-local-studio-litter-bridge-secret";
const ROUTE_PATH = "/api/litter-bridge/v1";
const PROTOCOL_VERSION = 1 as const;

type GatewayPiRuntime = {
  program: string;
  args: string[];
  env: Record<string, string>;
};

type GatewayMetadata = {
  protocolVersion: 1;
  url: string;
  secretHeader: typeof SECRET_HEADER;
  secret: string;
  controllerId: string;
  pid: number;
  issuedAt: string;
  piAgentDir?: string;
  piRuntime?: GatewayPiRuntime;
};

type MetadataPublisherOptions = {
  dataDir?: string;
  secret?: string;
  controllerId?: string;
  displayName?: string;
  now?: () => Date;
};

const boundedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 512
    ? value
    : null;

const writePrivateJson = (filepath: string, value: unknown): void => {
  const temporary = `${filepath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, filepath);
  chmodSync(filepath, 0o600);
};

const controllerIdFile = (dataDir: string): string => path.join(dataDir, "litter-controller-id");
const metadataFile = (dataDir: string): string => path.join(dataDir, "litter-bridge.json");

const resolvePiAgentDir = (dataDir: string): string => {
  const explicit = process.env.PI_CODING_AGENT_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  return path.resolve(path.join(dataDir, "pi-agent"));
};

const resolvePiRuntime = (): GatewayPiRuntime | null => {
  try {
    const mainUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
    const distDir = path.dirname(fileURLToPath(mainUrl));
    const cli = path.join(distDir, "cli.js");
    const env: Record<string, string> = {};
    if (process.versions.electron) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }
    return { program: process.execPath, args: [cli], env };
  } catch {
    return null;
  }
};

const loadControllerId = (dataDir: string): string => {
  const filepath = controllerIdFile(dataDir);
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

export type { GatewayMetadata, GatewayPiRuntime, MetadataPublisherOptions };
export { SECRET_HEADER, ROUTE_PATH, PROTOCOL_VERSION as LITTER_BRIDGE_PROTOCOL_VERSION };

export function createLitterBridgeMetadataPublisher(options: MetadataPublisherOptions = {}) {
  const dataDir = options.dataDir ?? resolveDataDir();
  const secret =
    options.secret ??
    process.env.LOCAL_STUDIO_LITTER_BRIDGE_SECRET?.trim() ??
    randomBytes(32).toString("base64url");
  if (secret.length < 32 || secret.length > 512) throw new Error("Invalid Litter bridge secret");
  const controllerId = options.controllerId ?? loadControllerId(dataDir);
  const displayName = options.displayName ?? `Local Studio on ${hostname()}`;
  const now = options.now ?? (() => new Date());
  let published: GatewayMetadata | null = null;

  void displayName;

  const publishMetadata = (port: number): void => {
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error("Invalid Litter bridge port");
    }
    const piRuntime = resolvePiRuntime();
    published = {
      protocolVersion: PROTOCOL_VERSION,
      url: `http://127.0.0.1:${port}${ROUTE_PATH}`,
      secretHeader: SECRET_HEADER,
      secret,
      controllerId,
      pid: process.pid,
      issuedAt: now().toISOString(),
      piAgentDir: resolvePiAgentDir(dataDir),
      ...(piRuntime ? { piRuntime } : {}),
    };
    writePrivateJson(metadataFile(dataDir), published);
  };

  const dispose = (): void => {
    if (published) {
      const filepath = metadataFile(dataDir);
      try {
        const current = JSON.parse(readFileSync(filepath, "utf8")) as Partial<GatewayMetadata>;
        if (current.pid === published.pid && current.secret === published.secret) {
          rmSync(filepath);
        }
      } catch {}
      published = null;
    }
  };

  return { publishMetadata, dispose, controllerId, secret };
}
