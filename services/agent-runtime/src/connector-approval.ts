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
import { authorizedConnectorTool, callConnectorTool, listConnectorTools } from "./connector-pool";
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
  schemaDigest: Buffer;
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

const connectorApprovalSchemaDigest = (
  key: BinaryLike,
  inputSchema: ConnectorJson | undefined,
): Buffer =>
  createHmac("sha256", key)
    .update("local-studio.connector-approval-schema.v1\0")
    .update(canonical(inputSchema ?? null))
    .digest();

type JsonObject = Readonly<Record<string, ConnectorJson>>;

const SENSITIVE_ARGUMENT_PARTS = new Set([
  "auth",
  "authentication",
  "authorization",
  "confidential",
  "cookie",
  "credential",
  "credentials",
  "key",
  "otp",
  "passphrase",
  "password",
  "pin",
  "private",
  "secret",
  "sig",
  "signature",
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
  "signingkey",
]);
const SENSITIVE_SCHEMA_FORMATS = new Set(["credential", "password", "secret", "token"]);
const MAX_ARGUMENTS = 48;
const MAX_COLLECTION_ITEMS = 6;
const MAX_PREVIEW_DEPTH = 2;
const MAX_PREVIEW_LINE = 320;
const MAX_STRING_PREVIEW = 120;
const MAX_SCHEMA_DEPTH = 12;

const sanitizedVisibleText = (value: string): string =>
  value.replace(/\p{Cf}/gu, "").replace(/\p{Cc}/gu, " ");

const normalizedVisibleText = (value: string): string =>
  sanitizedVisibleText(value.normalize("NFKD")).replace(/\p{M}/gu, "").normalize("NFKC");

const boundedLabel = (value: string, maximum = 96): string => {
  const visible = sanitizedVisibleText(value);
  return visible.length <= maximum ? visible : visible.slice(0, maximum - 1) + "…";
};

const normalizedArgumentKey = (key: string): string =>
  normalizedVisibleText(key)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z\d]+/g, "_")
    .replace(/^_|_$/g, "");

const isSensitiveArgumentKey = (key: string): boolean => {
  const normalized = normalizedArgumentKey(key);
  const compact = normalized.replaceAll("_", "");
  return (
    SENSITIVE_ARGUMENT_KEYS.has(compact) ||
    normalized.split("_").some((part) => SENSITIVE_ARGUMENT_PARTS.has(part)) ||
    /(?:access|api|auth|bearer|client|private|refresh|secret|session|signing)?(?:credential|key|password|secret|signature|token)$/.test(
      compact,
    )
  );
};

const jsonObject = (value: ConnectorJson | undefined): JsonObject | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

const localReference = (
  root: ConnectorJson | undefined,
  reference: string,
): ConnectorJson | undefined => {
  if (!reference.startsWith("#/")) return undefined;
  let value = root;
  for (const encoded of reference.slice(2).split("/")) {
    const object = jsonObject(value);
    if (!object) return undefined;
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!Object.hasOwn(object, key)) return undefined;
    value = object[key];
  }
  return value;
};

const resolvedSchemas = (
  schema: ConnectorJson | undefined,
  root: ConnectorJson | undefined,
  depth = 0,
  seen = new Set<ConnectorJson>(),
): ConnectorJson[] => {
  if (schema === undefined || depth >= MAX_SCHEMA_DEPTH || seen.has(schema)) return [];
  const nextSeen = new Set(seen).add(schema);
  if (schema === true || schema === false) return [schema];
  const object = jsonObject(schema);
  if (!object) return [];
  const resolved: ConnectorJson[] = [object];
  if ("$ref" in object) {
    if (typeof object.$ref !== "string") return [];
    const referenced = localReference(root, object.$ref);
    if (referenced === undefined) return [];
    const referenceSchemas = resolvedSchemas(referenced, root, depth + 1, nextSeen);
    if (referenceSchemas.length === 0) return [];
    resolved.push(...referenceSchemas);
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const branches = object[keyword];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches)
      resolved.push(...resolvedSchemas(branch, root, depth + 1, nextSeen));
  }
  return resolved;
};

const schemaMarksSensitive = (
  schema: ConnectorJson | undefined,
  root: ConnectorJson | undefined,
): boolean =>
  resolvedSchemas(schema, root).some((candidate) => {
    const object = jsonObject(candidate);
    if (!object) return false;
    if (object.writeOnly === true || object.sensitive === true || object.secret === true)
      return true;
    if (
      Object.entries(object).some(
        ([key, value]) =>
          value === true &&
          (normalizedArgumentKey(key) === "x_sensitive" || isSensitiveArgumentKey(key)),
      )
    )
      return true;
    if (typeof object.contentEncoding === "string" || typeof object.contentMediaType === "string")
      return true;
    if (
      [object.title, object.description, object.format, object.contentEncoding].some(
        (value) => typeof value === "string" && isSensitiveArgumentKey(value),
      )
    )
      return true;
    return (
      typeof object.format === "string" &&
      SENSITIVE_SCHEMA_FORMATS.has(normalizedArgumentKey(object.format))
    );
  });

const primitiveType = (value: ConnectorJson): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
};

const schemaAllowsValue = (
  schema: ConnectorJson | undefined,
  value: ConnectorJson,
  root: ConnectorJson | undefined,
): boolean =>
  resolvedSchemas(schema, root).some((candidate) => {
    if (candidate === true) return false;
    const object = jsonObject(candidate);
    if (!object || Object.keys(object).length === 0) return false;
    if ("const" in object && Object.is(object.const, value)) return true;
    if (Array.isArray(object.enum) && object.enum.some((entry) => Object.is(entry, value)))
      return true;
    const expected = primitiveType(value);
    const declared = object.type;
    if (declared === expected) return true;
    if (declared === "integer" && typeof value === "number" && Number.isInteger(value)) return true;
    if (Array.isArray(declared) && declared.includes(expected)) return true;
    if (
      Array.isArray(declared) &&
      declared.includes("integer") &&
      typeof value === "number" &&
      Number.isInteger(value)
    )
      return true;
    if (expected === "object" && jsonObject(object.properties)) return true;
    if (expected === "array" && ("items" in object || "prefixItems" in object)) return true;
    return false;
  });

const schemaForProperty = (
  schema: ConnectorJson | undefined,
  key: string,
  root: ConnectorJson | undefined,
): ConnectorJson[] => {
  const matches: ConnectorJson[] = [];
  for (const candidate of resolvedSchemas(schema, root)) {
    const object = jsonObject(candidate);
    if (!object) continue;
    const properties = jsonObject(object.properties);
    const directlyDeclared = properties !== undefined && Object.hasOwn(properties, key);
    if (directlyDeclared) matches.push(properties[key] as ConnectorJson);
    const additional = object.additionalProperties;
    if (!directlyDeclared && jsonObject(additional)) matches.push(additional as ConnectorJson);
  }
  return matches;
};

const schemaForItem = (
  schema: ConnectorJson | undefined,
  index: number,
  root: ConnectorJson | undefined,
): ConnectorJson[] => {
  const matches: ConnectorJson[] = [];
  for (const candidate of resolvedSchemas(schema, root)) {
    const object = jsonObject(candidate);
    if (!object) continue;
    if (Array.isArray(object.prefixItems) && object.prefixItems[index] !== undefined)
      matches.push(object.prefixItems[index] as ConnectorJson);
    else if (jsonObject(object.items)) matches.push(object.items as ConnectorJson);
  }
  return matches;
};

const combineSchemas = (schemas: ConnectorJson[]): ConnectorJson | undefined =>
  schemas.length === 0 ? undefined : schemas.length === 1 ? schemas[0] : { allOf: schemas };

const redactVisibleUrl = (value: string): string => {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value.trim())) return value;
  try {
    const url = new URL(value);
    if (url.username) url.username = "[redacted]";
    if (url.password) url.password = "[redacted]";
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveArgumentKey(key)) url.searchParams.set(key, "[redacted]");
    }
    if (url.hash.includes("=")) {
      const fragment = new URLSearchParams(url.hash.slice(1));
      let changed = false;
      for (const key of [...fragment.keys()]) {
        if (!isSensitiveArgumentKey(key)) continue;
        fragment.set(key, "[redacted]");
        changed = true;
      }
      if (changed) url.hash = fragment.toString();
    }
    return url.toString();
  } catch {
    return value;
  }
};

const SECRET_NAME =
  "(?:api[-_]?key|access[-_]?key|access[-_]?token|auth(?:orization|entication)?|bearer[-_]?token|client[-_]?secret|cookie|credentials?|otp|passphrase|password|pin|private[-_]?key|refresh[-_]?token|secret|session[-_]?(?:cookie|key|token)|sig|signatures?|signing[-_]?key|token)";
const SECRET_VALUE = "(?:(?:basic|digest|bearer)\\s+[^\\s,;]+|\\\"[^\\\"]*\\\"|'[^']*'|[^\\s,;&]+)";
const ASSIGNMENT_SECRET = new RegExp(
  "(" + SECRET_NAME + "[\\\"']?\\s*[:=]\\s*)" + SECRET_VALUE,
  "gi",
);
const FLAG_SECRET = new RegExp(
  "((?:--?|/)" + SECRET_NAME + "(?:\\s*=\\s*|\\s+))" + SECRET_VALUE,
  "gi",
);

const redactVisibleString = (value: string): string =>
  redactVisibleUrl(normalizedVisibleText(value))
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@")
    .replace(/(\bbearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(FLAG_SECRET, "$1[redacted]")
    .replace(ASSIGNMENT_SECRET, "$1[redacted]");

const opaquePreview = (value: ConnectorJson): string => {
  if (value === null) return "null";
  if (typeof value === "string") return "string (" + value.length + ")";
  if (Array.isArray(value)) return "array (" + value.length + ")";
  if (typeof value === "object") return "object (" + Object.keys(value).length + ")";
  return typeof value;
};

const previewArgument = (
  value: ConnectorJson,
  key: string,
  schema: ConnectorJson | undefined,
  root: ConnectorJson | undefined,
  depth = 0,
): string => {
  if (isSensitiveArgumentKey(key) || schemaMarksSensitive(schema, root)) return "[redacted]";
  if (!schemaAllowsValue(schema, value, root)) return opaquePreview(value);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string")
    return JSON.stringify(boundedLabel(redactVisibleString(value), MAX_STRING_PREVIEW));
  if (Array.isArray(value)) {
    if (depth >= MAX_PREVIEW_DEPTH) return "array (" + value.length + ")";
    const shown = value.slice(0, MAX_COLLECTION_ITEMS);
    const omitted = value.length - shown.length;
    const preview = shown.map((entry, index) => {
      const itemSchema = combineSchemas(schemaForItem(schema, index, root));
      return previewArgument(entry, key, itemSchema, root, depth + 1);
    });
    if (omitted > 0) preview.push("… " + omitted + " more items omitted");
    return "[" + preview.join(", ") + "]";
  }
  const object = value as JsonObject;
  const keys = Object.keys(object).sort();
  if (depth >= MAX_PREVIEW_DEPTH) return "object (" + keys.length + ")";
  const shown = keys.slice(0, MAX_COLLECTION_ITEMS);
  const omitted = keys.length - shown.length;
  const preview = shown.map((nestedKey) => {
    const nestedSchema = combineSchemas(schemaForProperty(schema, nestedKey, root));
    return (
      boundedLabel(nestedKey, 48) +
      ": " +
      previewArgument(object[nestedKey] as ConnectorJson, nestedKey, nestedSchema, root, depth + 1)
    );
  });
  if (omitted > 0) preview.push("… " + omitted + " more fields omitted");
  return "{ " + preview.join(", ") + " }";
};

const summarize = (args: ConnectorArguments, schema?: ConnectorJson): string[] => {
  const keys = Object.keys(args).sort();
  const shown = keys.slice(0, MAX_ARGUMENTS);
  const omitted = keys.length - shown.length;
  const rootSensitive = schemaMarksSensitive(schema, schema);
  const summary = shown.map((key) => {
    const argumentSchema = rootSensitive
      ? ({ writeOnly: true } as ConnectorJson)
      : combineSchemas(schemaForProperty(schema, key, schema));
    return boundedLabel(
      boundedLabel(key) +
        ": " +
        previewArgument(args[key] as ConnectorJson, key, argumentSchema, schema),
      MAX_PREVIEW_LINE,
    );
  });
  if (omitted > 0) summary.push("… " + omitted + " more arguments omitted");
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

  begin(scope: Scope, signal?: AbortSignal, inputSchema?: ConnectorJson): ConnectorApprovalView {
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
      argumentSummary: summarize(scope.args, inputSchema),
    };
    const cancel = () => this.finish(id, "cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    this.entries.set(id, {
      sessionId: scope.sessionId,
      connectorId: boundedLabel(scope.connector.id),
      digest: connectorApprovalDigest(this.key, scope),
      schemaDigest: connectorApprovalSchemaDigest(this.key, inputSchema),
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

  consume(id: string, scope: Scope, approved: boolean, inputSchema?: ConnectorJson): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) return this.finish(id, "expired") && false;
    if (!approved) return this.finish(id, "denied") && false;
    const matches =
      timingSafeEqual(connectorApprovalDigest(this.key, scope), entry.digest) &&
      timingSafeEqual(connectorApprovalSchemaDigest(this.key, inputSchema), entry.schemaDigest);
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

const connectorToolInputSchema = async (
  connectorId: string,
  tool: string,
): Promise<ConnectorJson> => {
  const metadata = (await listConnectorTools(connectorId)).find((entry) => entry.name === tool);
  if (!metadata) throw new ConnectorApprovalError("Connector tool metadata is unavailable");
  return Schema.decodeUnknownSync(Schema.Json)(metadata.inputSchema);
};

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
  const inputSchema = await connectorToolInputSchema(input.connectorId, input.tool);
  const approval = broker.begin(
    scope(input.sessionId, connector, input.tool, args),
    input.signal,
    inputSchema,
  );
  try {
    const approved = await input.approve(approval).catch(() => false);
    await authorizedConnectorTool(input.connectorId, input.tool);
    const currentInputSchema = approved
      ? await connectorToolInputSchema(input.connectorId, input.tool)
      : inputSchema;
    const current = await authorizedConnectorTool(input.connectorId, input.tool);
    if (
      input.signal?.aborted ||
      !broker.consume(
        approval.id,
        scope(input.sessionId, current, input.tool, args),
        approved,
        currentInputSchema,
      )
    )
      throw new ConnectorApprovalError("Connector action was not approved for this request");
    return callConnectorTool(current, input.tool, args, input.signal);
  } finally {
    broker.consume(
      approval.id,
      scope(input.sessionId, connector, input.tool, args),
      false,
      inputSchema,
    );
  }
}

getGlobalSingleton<ConnectorApprovalBridge>("connectorApprovalBridge", () => ({
  execute: executeConnectorTool,
  cancel: cancelConnectorApprovals,
}));
