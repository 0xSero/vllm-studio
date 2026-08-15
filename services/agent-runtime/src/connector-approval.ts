import { createHmac, randomBytes, randomUUID, timingSafeEqual, type BinaryLike } from "node:crypto";
import { Effect, Fiber, Schema } from "effect";
import {
  ConnectorArgumentsSchema,
  type ConnectorArguments,
  type ConnectorApprovalBridge,
  type ConnectorApprovalView,
  type ConnectorConfig,
  type ConnectorJson,
  type ConnectorRisk,
} from "./connector-contract";
import { authorizedConnectorTool, callConnectorTool } from "./connector-pool";
import { connectorToolRisk } from "./connector-policy";
import { getGlobalSingleton } from "./instances";

type Scope = {
  sessionId: string;
  connector: ConnectorConfig;
  tool: string;
  args: ConnectorArguments;
};
type Outcome = "denied" | "expired" | "consumed" | "cancelled";
type Entry = {
  sessionId: string;
  connectorId: string;
  digest: Buffer;
  expiresAt: number;
  view: ConnectorApprovalView;
  detach: () => void;
  timeout: Fiber.Fiber<void, unknown> | null;
};
type BrokerOptions = { key?: BinaryLike; ttlMs?: number; now?: () => number };
const canonical = (value: ConnectorJson): string => {
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Readonly<Record<string, ConnectorJson>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key] as ConnectorJson)}`)
    .join(",")}}`;
};

export const connectorApprovalDigest = (key: BinaryLike, scope: Scope): Buffer =>
  createHmac("sha256", key)
    .update("local-studio.connector-approval.v1\0")
    .update(canonical(JSON.parse(JSON.stringify(scope)) as ConnectorJson))
    .digest();

const boundedLabel = (value: string, maximum = 96): string => {
  const visible = value.replace(/[\p{Cc}\p{Cf}]/gu, "�");
  return visible.length <= maximum ? visible : `${visible.slice(0, maximum - 1)}…`;
};

const SENSITIVE_ARGUMENT_PARTS = new Set([
  "auth",
  "authentication",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "key",
  "passphrase",
  "password",
  "secret",
  "token",
]);
const SENSITIVE_ARGUMENT_KEYS = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "authtoken",
  "bearertoken",
  "clientsecret",
  "privatekey",
  "secretkey",
  "sessioncookie",
  "sessionkey",
  "sessiontoken",
]);
const VISIBLE_STRING_ARGUMENTS = new Set([
  "account",
  "action",
  "attendee",
  "attendees",
  "bcc",
  "body",
  "branch",
  "cc",
  "channel",
  "command",
  "comment",
  "content",
  "description",
  "destination",
  "directory",
  "email",
  "end",
  "endpoint",
  "event",
  "file",
  "filename",
  "from",
  "host",
  "id",
  "issue",
  "issue_number",
  "label",
  "labels",
  "location",
  "message",
  "method",
  "name",
  "operation",
  "organization",
  "org",
  "owner",
  "path",
  "project",
  "prompt",
  "pull_number",
  "pull_request",
  "query",
  "recipient",
  "recipients",
  "ref",
  "repo",
  "repository",
  "resource",
  "role",
  "room",
  "scope",
  "source",
  "start",
  "state",
  "status",
  "subject",
  "summary",
  "target",
  "text",
  "title",
  "to",
  "tweet",
  "type",
  "timezone",
  "uri",
  "url",
]);
const MAX_ARGUMENTS = 48;
const MAX_COLLECTION_ITEMS = 6;
const MAX_PREVIEW_DEPTH = 2;
const MAX_PREVIEW_LINE = 320;

const normalizedArgumentKey = (key: string): string =>
  key
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z\d]+/g, "_")
    .replace(/^_|_$/g, "");

const isSensitiveArgumentKey = (key: string): boolean => {
  const normalized = normalizedArgumentKey(key);
  return (
    SENSITIVE_ARGUMENT_KEYS.has(normalized.replaceAll("_", "")) ||
    normalized.split("_").some((part) => SENSITIVE_ARGUMENT_PARTS.has(part))
  );
};

const isVisibleStringArgument = (key: string): boolean => {
  const normalized = normalizedArgumentKey(key);
  return (
    VISIBLE_STRING_ARGUMENTS.has(normalized) ||
    ["_id", "_name", "_path", "_ref", "_target", "_uri", "_url"].some((suffix) =>
      normalized.endsWith(suffix),
    )
  );
};

const redactVisibleUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.username) url.username = "[redacted]";
    if (url.password) url.password = "[redacted]";
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveArgumentKey(key)) url.searchParams.set(key, "[redacted]");
    }
    if (url.hash.includes("=")) {
      const fragment = new URLSearchParams(url.hash.slice(1));
      let redacted = false;
      for (const key of [...fragment.keys()]) {
        if (!isSensitiveArgumentKey(key)) continue;
        fragment.set(key, "[redacted]");
        redacted = true;
      }
      if (redacted) url.hash = fragment.toString();
    }
    return url.toString();
  } catch {
    return value;
  }
};

const redactVisibleString = (value: string): string =>
  redactVisibleUrl(value)
    .replace(/(\bbearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(
      /((?:api[-_]?key|access[-_]?token|auth(?:orization|entication)?|cookie|credentials?|passphrase|password|private[-_]?key|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      "$1[redacted]",
    );

const previewArgument = (value: ConnectorJson, key: string, depth = 0): string => {
  if (isSensitiveArgumentKey(key)) return "[redacted]";
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (!isVisibleStringArgument(key)) return `string (${value.length})`;
    return JSON.stringify(boundedLabel(redactVisibleString(value), 120));
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_PREVIEW_DEPTH) return `array (${value.length})`;
    const shown = value.slice(0, MAX_COLLECTION_ITEMS);
    const omitted = value.length - shown.length;
    return `[${shown.map((entry) => previewArgument(entry, key, depth + 1)).join(", ")}${
      omitted > 0 ? `, … ${omitted} more items omitted` : ""
    }]`;
  }
  const object = value as Readonly<Record<string, ConnectorJson>>;
  const keys = Object.keys(object).sort();
  if (depth >= MAX_PREVIEW_DEPTH) return `object (${keys.length})`;
  const shown = keys.slice(0, MAX_COLLECTION_ITEMS);
  const omitted = keys.length - shown.length;
  return `{ ${shown
    .map(
      (nestedKey) =>
        `${boundedLabel(nestedKey, 48)}: ${previewArgument(
          object[nestedKey] as ConnectorJson,
          nestedKey,
          depth + 1,
        )}`,
    )
    .join(", ")}${omitted > 0 ? `, … ${omitted} more fields omitted` : ""} }`;
};

const summarize = (args: ConnectorArguments): string[] => {
  const keys = Object.keys(args).sort();
  const shown = keys.slice(0, MAX_ARGUMENTS);
  const omitted = keys.length - shown.length;
  const summary = shown.map((key) =>
    boundedLabel(
      `${boundedLabel(key)}: ${previewArgument(args[key] as ConnectorJson, key)}`,
      MAX_PREVIEW_LINE,
    ),
  );
  if (omitted > 0) summary.push(`… ${omitted} more arguments omitted`);
  return summary;
};

class ConnectorApprovalBroker {
  private readonly key: BinaryLike;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly events: Array<{
    connector: string;
    tool: string;
    risk: ConnectorRisk;
    outcome: Outcome;
    at: string;
  }> = [];

  constructor(options: BrokerOptions = {}) {
    this.key = options.key ?? randomBytes(32);
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  begin(scope: Scope, signal?: AbortSignal): ConnectorApprovalView {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= this.now()) this.finish(id, "expired");
    }
    if (this.entries.size >= 128) throw new Error("Connector approval queue is full");
    const id = randomUUID();
    const view = {
      id,
      connectorName: boundedLabel(scope.connector.name),
      tool: boundedLabel(scope.tool),
      risk: connectorToolRisk(scope.connector, scope.tool),
      argumentSummary: summarize(scope.args),
    };
    const cancel = () => this.finish(id, "cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    this.entries.set(id, {
      sessionId: scope.sessionId,
      connectorId: boundedLabel(scope.connector.id),
      digest: connectorApprovalDigest(this.key, scope),
      expiresAt: this.now() + this.ttlMs,
      view,
      detach: () => signal?.removeEventListener("abort", cancel),
      timeout: null,
    });
    const entry = this.entries.get(id);
    if (entry)
      entry.timeout = Effect.runFork(
        Effect.sleep(this.ttlMs).pipe(
          Effect.tap(() => Effect.sync(() => this.finish(id, "expired", false))),
        ),
      );
    if (signal?.aborted) cancel();
    return view;
  }

  consume(id: string, scope: Scope, approved: boolean): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) return this.finish(id, "expired") && false;
    if (!approved) return this.finish(id, "denied") && false;
    const matches = timingSafeEqual(connectorApprovalDigest(this.key, scope), entry.digest);
    this.finish(id, matches ? "consumed" : "denied");
    return matches;
  }

  cancelSession(sessionId: string): number {
    let count = 0;
    for (const [id, entry] of this.entries)
      if (entry.sessionId === sessionId && this.finish(id, "cancelled")) count += 1;
    return count;
  }

  audit() {
    return this.events.map((event) => ({ ...event }));
  }

  private finish(id: string, outcome: Outcome, interruptTimeout = true): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    entry.detach();
    if (interruptTimeout && entry.timeout) {
      void Effect.runPromise(Fiber.interrupt(entry.timeout));
    }
    this.events.push({
      connector: entry.connectorId,
      tool: entry.view.tool,
      risk: entry.view.risk,
      outcome,
      at: new Date(this.now()).toISOString(),
    });
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
    return true;
  }
}

export const createConnectorApprovalBroker = (options: BrokerOptions = {}) =>
  new ConnectorApprovalBroker(options);
const broker = getGlobalSingleton("connectorApprovalBroker", createConnectorApprovalBroker);
export const cancelConnectorApprovals = (sessionId: string): number =>
  broker.cancelSession(sessionId);
export class ConnectorApprovalError extends Error {}

const scope = (
  sessionId: string,
  connector: ConnectorConfig,
  tool: string,
  args: ConnectorArguments,
): Scope => ({ sessionId, connector, tool, args });

export async function executeConnectorTool(input: {
  sessionId: string;
  connectorId: string;
  tool: string;
  args: unknown;
  signal?: AbortSignal;
  approve?: (view: ConnectorApprovalView) => Promise<boolean>;
}): Promise<unknown> {
  const args = Schema.decodeUnknownSync(ConnectorArgumentsSchema)(input.args);
  const connector = await authorizedConnectorTool(input.connectorId, input.tool);
  if (connectorToolRisk(connector, input.tool) === "read")
    return callConnectorTool(connector, input.tool, args, input.signal);
  if (!input.approve) throw new ConnectorApprovalError("Connector action requires approval");
  const approval = broker.begin(scope(input.sessionId, connector, input.tool, args), input.signal);
  try {
    const approved = await input.approve(approval).catch(() => false);
    const current = await authorizedConnectorTool(input.connectorId, input.tool);
    if (
      input.signal?.aborted ||
      !broker.consume(approval.id, scope(input.sessionId, current, input.tool, args), approved)
    )
      throw new ConnectorApprovalError("Connector action was not approved for this request");
    return callConnectorTool(current, input.tool, args, input.signal);
  } finally {
    broker.consume(approval.id, scope(input.sessionId, connector, input.tool, args), false);
  }
}

getGlobalSingleton<ConnectorApprovalBridge>("connectorApprovalBridge", () => ({
  execute: executeConnectorTool,
  cancel: cancelConnectorApprovals,
}));
