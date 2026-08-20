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
type JsonLimits = { label: "request" | "schema"; bytes: number; depth: number; nodes: number };
const REQUEST_LIMITS = { label: "request", bytes: 1_048_576, depth: 64, nodes: 16_384 } as const;
const SCHEMA_LIMITS = { label: "schema", bytes: 65_536, depth: 32, nodes: 2_048 } as const;

const limitError = (label: JsonLimits["label"]) =>
  new Error(`Connector approval ${label} exceeds safety limits`);

const assertBoundedJson = (value: unknown, limits: JsonLimits): void => {
  const active = new Set<object>();
  const stack: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value, depth: 0 }];
  let bytes = 0;
  let nodes = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    if (frame.exit) {
      active.delete(frame.value as object);
      continue;
    }
    nodes += 1;
    if (nodes > limits.nodes || frame.depth > limits.depth) throw limitError(limits.label);
    if (typeof frame.value === "string") {
      if (frame.value.length > limits.bytes) throw limitError(limits.label);
      bytes += Buffer.byteLength(frame.value);
      if (bytes > limits.bytes) throw limitError(limits.label);
      continue;
    }
    if (frame.value === null || typeof frame.value !== "object") {
      bytes += 16;
      if (bytes > limits.bytes) throw limitError(limits.label);
      continue;
    }
    if (active.has(frame.value)) throw limitError(limits.label);
    active.add(frame.value);
    stack.push({ ...frame, exit: true });
    if (Array.isArray(frame.value)) {
      for (let index = frame.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: frame.value[index], depth: frame.depth + 1 });
      }
      continue;
    }
    for (const key in frame.value) {
      if (!Object.hasOwn(frame.value, key)) continue;
      if (key.length > limits.bytes) throw limitError(limits.label);
      bytes += Buffer.byteLength(key);
      if (bytes > limits.bytes) throw limitError(limits.label);
      stack.push({
        value: (frame.value as Record<string, unknown>)[key],
        depth: frame.depth + 1,
      });
    }
  }
};

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

export const connectorApprovalDigest = (key: BinaryLike, scope: Scope): Buffer => {
  assertBoundedJson(scope, REQUEST_LIMITS);
  return createHmac("sha256", key)
    .update("local-studio.connector-approval.v1\0")
    .update(canonical(JSON.parse(JSON.stringify(scope)) as ConnectorJson))
    .digest();
};

const connectorApprovalSchemaDigest = (
  key: BinaryLike,
  inputSchema: ConnectorJson | undefined,
): Buffer => {
  assertBoundedJson(inputSchema ?? null, SCHEMA_LIMITS);
  return createHmac("sha256", key)
    .update("local-studio.connector-approval-schema.v1\0")
    .update(canonical(inputSchema ?? null))
    .digest();
};

type JsonObject = Readonly<Record<string, ConnectorJson>>;

const SENSITIVE_ARGUMENT_PARTS = new Set([
  "auth",
  "authentication",
  "authorization",
  "bearer",
  "confidential",
  "cookie",
  "credential",
  "credentials",
  "csrf",
  "jwt",
  "key",
  "oauth",
  "otp",
  "passcode",
  "passphrase",
  "password",
  "passwd",
  "pat",
  "pin",
  "private",
  "pwd",
  "secret",
  "sig",
  "signature",
  "sso",
  "token",
  "xsrf",
]);
const SENSITIVE_ARGUMENT_KEYS = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "apitoken",
  "authtoken",
  "bearertoken",
  "clientcredential",
  "clientsecret",
  "csrftoken",
  "idtoken",
  "jwt",
  "oauth",
  "oauthtoken",
  "passcode",
  "passwd",
  "pat",
  "privatekey",
  "pwd",
  "refreshtoken",
  "secretkey",
  "sessioncookie",
  "sessionkey",
  "sessiontoken",
  "signingkey",
  "xsrftoken",
]);
const SENSITIVE_SCHEMA_FORMATS = new Set(["credential", "password", "secret", "token"]);
const MAX_ARGUMENTS = 48;
const MAX_COLLECTION_ITEMS = 6;
const MAX_PREVIEW_DEPTH = 2;
const MAX_PREVIEW_LINE = 320;
const MAX_STRING_PREVIEW = 120;
const [MAX_KEY_WORK, MAX_STRING_WORK] = [256, 512];
const [MAX_SCHEMA_INSPECTION_DEPTH, MAX_SCHEMA_BRANCHES, MAX_SCHEMA_WORK] = [24, 128, 8_192];

const sanitizedVisibleText = (value: string): string =>
  value.replace(/\p{Cf}/gu, "").replace(/\p{Cc}/gu, " ");

const normalizedVisibleText = (value: string): string =>
  sanitizedVisibleText(value.normalize("NFKD")).replace(/\p{M}/gu, "").normalize("NFKC");

const boundedLabel = (value: string, maximum = 96): string => {
  const visible = sanitizedVisibleText(value.slice(0, maximum + 1));
  return visible.length <= maximum ? visible : visible.slice(0, maximum - 1) + "…";
};

const normalizedArgumentKey = (key: string): string =>
  normalizedVisibleText(key.slice(0, MAX_KEY_WORK))
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
    /(?:access|api|auth|bearer|client|private|refresh|secret|session|signing)?(?:credential|creds?|hmac|jwt|key|pass(?:code|phrase|word)?|passwd|pat|pwd|sas|secret|sessionid|signature|token)$/.test(
      compact,
    )
  );
};

const isInspectableArgumentKey = (key: string): boolean =>
  key.length <= MAX_KEY_WORK && /^[\x20-\x7e]+$/.test(key);

const jsonObject = (value: ConnectorJson | undefined): JsonObject | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

const localReference = (
  root: ConnectorJson | undefined,
  reference: string,
): ConnectorJson | undefined => {
  if (reference === "#") return root;
  if (
    reference.length > MAX_STRING_WORK ||
    !reference.startsWith("#/") ||
    /~(?:[^01]|$)/.test(reference)
  )
    return undefined;
  let value = root;
  const segments = reference.slice(2).split("/");
  if (segments.length > MAX_SCHEMA_INSPECTION_DEPTH) return undefined;
  for (const encoded of segments) {
    const object = jsonObject(value);
    if (!object) return undefined;
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!Object.hasOwn(object, key)) return undefined;
    value = object[key];
  }
  return value;
};

type SchemaInspection = { root: ConnectorJson; resolved: Map<ConnectorJson, ConnectorJson[]> };
type SchemaValidation = {
  root: ConnectorJson;
  memo: Map<ConnectorJson, boolean>;
  visiting: Set<ConnectorJson>;
  disclosable: boolean;
  branches: number;
  work: number;
};
const JSON_SCHEMA_TYPES = new Set("array boolean integer null number object string".split(" "));
const SCHEMA_MAP_KEYWORDS = "$defs definitions properties".split(" ");
const SCHEMA_STRING_KEYWORDS =
  "$anchor $comment $id contentEncoding contentMediaType description format title".split(" ");
const SCHEMA_BOOLEAN_KEYWORDS = "deprecated readOnly secret sensitive writeOnly".split(" ");
const SUPPORTED_SCHEMA_KEYWORDS = new Set(
  "$anchor $comment $defs $id $ref additionalProperties allOf anyOf contentEncoding contentMediaType default definitions deprecated description examples format items oneOf prefixItems properties readOnly required secret sensitive title type writeOnly".split(
    " ",
  ),
);
const SAFE_REFERENCE_SIBLINGS = new Set(
  "$anchor $comment $defs $id $ref contentEncoding contentMediaType default definitions deprecated description examples format readOnly secret sensitive title writeOnly".split(
    " ",
  ),
);

const spendSchemaWork = (state: SchemaValidation): void => {
  if (++state.work > MAX_SCHEMA_WORK) throw limitError("schema");
};

const validSchemaType = (value: ConnectorJson): boolean => {
  if (typeof value === "string") return value.length <= 16 && JSON_SCHEMA_TYPES.has(value);
  if (!Array.isArray(value) || value.length === 0) return false;
  const types = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length > 16 ||
      !JSON_SCHEMA_TYPES.has(entry) ||
      types.has(entry)
    )
      return false;
    types.add(entry);
  }
  return true;
};

const validateSchema = (schema: ConnectorJson, state: SchemaValidation, depth = 0): boolean => {
  spendSchemaWork(state);
  if (depth > MAX_SCHEMA_INSPECTION_DEPTH) throw limitError("schema");
  if (schema === false) {
    state.disclosable = false;
    return true;
  }
  if (schema === true) return true;
  const object = jsonObject(schema);
  if (!object) return false;
  const memoized = state.memo.get(schema);
  if (memoized !== undefined) return memoized;
  if (state.visiting.has(schema)) return false;
  state.visiting.add(schema);
  let valid = false;
  try {
    for (const key in object)
      if (Object.hasOwn(object, key) && !SUPPORTED_SCHEMA_KEYWORDS.has(key)) return false;
    if ("type" in object && !validSchemaType(object.type as ConnectorJson)) return false;
    for (const keyword of SCHEMA_STRING_KEYWORDS)
      if (keyword in object && typeof object[keyword] !== "string") return false;
    for (const keyword of SCHEMA_BOOLEAN_KEYWORDS)
      if (keyword in object && typeof object[keyword] !== "boolean") return false;
    if ("required" in object) {
      if (!Array.isArray(object.required)) return false;
      const required = new Set<string>();
      for (const entry of object.required) {
        if (typeof entry !== "string" || required.has(entry)) return false;
        required.add(entry);
      }
    }
    if ("examples" in object && !Array.isArray(object.examples)) return false;
    if ("$ref" in object) {
      if (typeof object.$ref !== "string") return false;
      const referenced = localReference(state.root, object.$ref);
      if (referenced === undefined || !validateSchema(referenced, state, depth + 1)) return false;
      for (const key in object)
        if (Object.hasOwn(object, key) && !SAFE_REFERENCE_SIBLINGS.has(key))
          state.disclosable = false;
    }
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      if (!(keyword in object)) continue;
      const branches = object[keyword];
      if (!Array.isArray(branches) || branches.length === 0) return false;
      state.branches += branches.length;
      if (state.branches > MAX_SCHEMA_BRANCHES) throw limitError("schema");
      for (const branch of branches) if (!validateSchema(branch, state, depth + 1)) return false;
      state.disclosable = false;
    }
    for (const keyword of SCHEMA_MAP_KEYWORDS) {
      if (!(keyword in object)) continue;
      const entries = jsonObject(object[keyword]);
      if (!entries) return false;
      for (const key in entries) {
        if (!Object.hasOwn(entries, key)) continue;
        spendSchemaWork(state);
        if (!validateSchema(entries[key] as ConnectorJson, state, depth + 1)) return false;
      }
    }
    for (const keyword of ["additionalProperties", "items"]) {
      if (!(keyword in object)) continue;
      if (keyword === "additionalProperties" && object[keyword] === false) continue;
      if (!validateSchema(object[keyword] as ConnectorJson, state, depth + 1)) return false;
    }
    if ("prefixItems" in object) {
      if (!Array.isArray(object.prefixItems)) return false;
      state.branches += object.prefixItems.length;
      if (state.branches > MAX_SCHEMA_BRANCHES) throw limitError("schema");
      for (const item of object.prefixItems)
        if (!validateSchema(item, state, depth + 1)) return false;
    }
    valid = true;
    return true;
  } finally {
    state.visiting.delete(schema);
    state.memo.set(schema, valid);
  }
};

const inspectSchema = (schema: ConnectorJson | undefined): SchemaInspection | undefined => {
  if (schema === undefined) return undefined;
  assertBoundedJson(schema, SCHEMA_LIMITS);
  const state: SchemaValidation = {
    root: schema,
    memo: new Map(),
    visiting: new Set(),
    disclosable: true,
    branches: 0,
    work: 0,
  };
  return validateSchema(schema, state) && state.disclosable
    ? { root: schema, resolved: new Map() }
    : undefined;
};

const resolvedSchemas = (
  schema: ConnectorJson | undefined,
  inspection: SchemaInspection | undefined,
): readonly ConnectorJson[] => {
  if (schema === undefined || !inspection) return [];
  const cached = inspection.resolved.get(schema);
  if (cached) return cached;
  const result: ConnectorJson[] = [];
  const seen = new Set<ConnectorJson>();
  const visit = (candidate: ConnectorJson): void => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    result.push(candidate);
    const object = jsonObject(candidate);
    if (!object) return;
    if (typeof object.$ref === "string") {
      const referenced = localReference(inspection.root, object.$ref);
      if (referenced !== undefined) visit(referenced);
    }
  };
  visit(schema);
  inspection.resolved.set(schema, result);
  return result;
};

const schemaMarksSensitive = (
  schema: ConnectorJson | undefined,
  inspection: SchemaInspection | undefined,
): boolean =>
  resolvedSchemas(schema, inspection).some((candidate) => {
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
  inspection: SchemaInspection | undefined,
): boolean =>
  resolvedSchemas(schema, inspection).some((candidate) => {
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
  inspection: SchemaInspection | undefined,
): ConnectorJson[] => {
  const matches: ConnectorJson[] = [];
  for (const candidate of resolvedSchemas(schema, inspection)) {
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
  inspection: SchemaInspection | undefined,
): ConnectorJson[] => {
  const matches: ConnectorJson[] = [];
  for (const candidate of resolvedSchemas(schema, inspection)) {
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

const redactVisibleUrl = (value: string): string | undefined => {
  const trimmed = value.trim();
  const relative = trimmed.startsWith("//");
  if (!relative && !/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return value;
  try {
    const url = new URL(trimmed, relative ? "https://approval.invalid" : undefined);
    if (url.username) url.username = "[redacted]";
    if (url.password) url.password = "[redacted]";
    if (shouldRedactUrlComponent(url.pathname)) url.pathname = "/[redacted]";
    for (const [key, parameter] of [...url.searchParams]) {
      if (shouldRedactUrlComponent(key) || shouldRedactUrlComponent(parameter))
        url.searchParams.set(key, "[redacted]");
    }
    if (url.hash && shouldRedactUrlComponent(url.hash.slice(1))) url.hash = "[redacted]";
    else if (url.hash.includes("=")) {
      const fragment = new URLSearchParams(url.hash.slice(1));
      let changed = false;
      for (const [key, parameter] of [...fragment]) {
        if (!shouldRedactUrlComponent(key) && !shouldRedactUrlComponent(parameter)) continue;
        fragment.set(key, "[redacted]");
        changed = true;
      }
      if (changed) url.hash = fragment.toString();
    }
    const redacted = url.toString();
    return relative ? redacted.slice("https:".length) : redacted;
  } catch {
    return undefined;
  }
};

const SECRET_NAME =
  "(?:api[-_]?(?:key|token)|access[-_]?(?:key|token)|auth(?:orization|entication)?|bearer(?:[-_]?token)?|client[-_]?(?:credential|secret)|cookie|credentials?|creds?|csrf(?:[-_]?token)?|hmac|id[-_]?token|jwt|oauth(?:[-_]?token)?|otp|pass|passcode|passphrase|password|passwd|pat|pin|private[-_]?key|pwd|refresh[-_]?token|sas|secret|session[-_]?(?:cookie|id|key|token)|sig|signatures?|signing[-_]?key|sso|token|xsrf(?:[-_]?token)?)";
const SECRET_VALUE = "(?:(?:basic|digest|bearer)\\s+[^\\s,;]+|\\\"[^\\\"]*\\\"|'[^']*'|[^\\s,;&]+)";
const ASSIGNMENT_SECRET = new RegExp(
  "(" + SECRET_NAME + "[\\\"']?\\s*[:=]\\s*)" + SECRET_VALUE,
  "gi",
);
const FLAG_SECRET = new RegExp(
  "((?:--?|/)" + SECRET_NAME + "(?:\\s*=\\s*|\\s+))" + SECRET_VALUE,
  "gi",
);

const decodedVisibleText = (value: string): string | undefined => {
  let decoded = value.slice(0, MAX_STRING_WORK);
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next.slice(0, MAX_STRING_WORK);
    } catch {
      return undefined;
    }
  }
  const visible = normalizedVisibleText(decoded);
  return /%[\da-f]{2}/i.test(decoded) || !/^[\x20-\x7e]*$/.test(visible) ? undefined : visible;
};

function shouldRedactUrlComponent(value: string): boolean {
  const visible = decodedVisibleText(value);
  if (visible === undefined) return true;
  return (
    isSensitiveArgumentKey(visible) ||
    visible.replace(FLAG_SECRET, "$1[redacted]").replace(ASSIGNMENT_SECRET, "$1[redacted]") !==
      visible
  );
}

const redactVisibleString = (value: string): string | undefined => {
  const visible = decodedVisibleText(value);
  if (visible === undefined) return undefined;
  return redactVisibleUrl(visible)
    ?.replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@")
    .replace(/(\bbearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(FLAG_SECRET, "$1[redacted]")
    .replace(ASSIGNMENT_SECRET, "$1[redacted]");
};

const boundedSortedKeys = (
  object: Readonly<Record<string, unknown>>,
  maximum: number,
): { shown: string[]; omitted: number } => {
  const shown: string[] = [];
  let count = 0;
  for (const key in object) {
    if (!Object.hasOwn(object, key)) continue;
    count += 1;
    if (shown.length < maximum) shown.push(key);
  }
  shown.sort((left, right) =>
    left.slice(0, MAX_KEY_WORK).localeCompare(right.slice(0, MAX_KEY_WORK)),
  );
  return { shown, omitted: count - shown.length };
};

const opaquePreview = (value: ConnectorJson): string => {
  if (value === null) return "null";
  if (typeof value === "string") return "string (" + value.length + ")";
  if (Array.isArray(value)) return "array (" + value.length + ")";
  if (typeof value === "object")
    return "object (" + boundedSortedKeys(value as JsonObject, 0).omitted + ")";
  return typeof value;
};

const previewArgument = (
  value: ConnectorJson,
  key: string,
  schema: ConnectorJson | undefined,
  inspection: SchemaInspection | undefined,
  depth = 0,
): string => {
  if (isSensitiveArgumentKey(key) || schemaMarksSensitive(schema, inspection)) return "[redacted]";
  if (!isInspectableArgumentKey(key) || !schemaAllowsValue(schema, value, inspection))
    return opaquePreview(value);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    const redacted = redactVisibleString(value);
    return redacted === undefined
      ? opaquePreview(value)
      : JSON.stringify(boundedLabel(redacted, MAX_STRING_PREVIEW));
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_PREVIEW_DEPTH) return "array (" + value.length + ")";
    const shown = value.slice(0, MAX_COLLECTION_ITEMS);
    const omitted = value.length - shown.length;
    const preview = shown.map((entry, index) => {
      const itemSchema = combineSchemas(schemaForItem(schema, index, inspection));
      return previewArgument(entry, key, itemSchema, inspection, depth + 1);
    });
    if (omitted > 0) preview.push("… " + omitted + " more items omitted");
    return "[" + preview.join(", ") + "]";
  }
  const object = value as JsonObject;
  const { shown, omitted } = boundedSortedKeys(object, MAX_COLLECTION_ITEMS);
  if (depth >= MAX_PREVIEW_DEPTH) return "object (" + (shown.length + omitted) + ")";
  const preview = shown.map((nestedKey) => {
    const nestedSchema = combineSchemas(schemaForProperty(schema, nestedKey, inspection));
    return (
      boundedLabel(nestedKey, 48) +
      ": " +
      previewArgument(
        object[nestedKey] as ConnectorJson,
        nestedKey,
        nestedSchema,
        inspection,
        depth + 1,
      )
    );
  });
  if (omitted > 0) preview.push("… " + omitted + " more fields omitted");
  return "{ " + preview.join(", ") + " }";
};

const summarize = (args: ConnectorArguments, schema?: ConnectorJson): string[] => {
  const inspection = inspectSchema(schema);
  const { shown, omitted } = boundedSortedKeys(args, MAX_ARGUMENTS);
  const rootSensitive = schemaMarksSensitive(schema, inspection);
  const summary = shown.map((key) => {
    const argumentSchema = rootSensitive
      ? ({ writeOnly: true } as ConnectorJson)
      : combineSchemas(schemaForProperty(schema, key, inspection));
    return boundedLabel(
      boundedLabel(key) +
        ": " +
        previewArgument(args[key] as ConnectorJson, key, argumentSchema, inspection),
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
    const digest = connectorApprovalDigest(this.key, scope);
    const schemaDigest = connectorApprovalSchemaDigest(this.key, inputSchema);
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
      digest,
      schemaDigest,
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
    let matches = false;
    try {
      matches =
        timingSafeEqual(connectorApprovalDigest(this.key, scope), entry.digest) &&
        timingSafeEqual(connectorApprovalSchemaDigest(this.key, inputSchema), entry.schemaDigest);
    } catch {
      matches = false;
    }
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
