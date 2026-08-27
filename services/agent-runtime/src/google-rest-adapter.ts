import { Option, Schema } from "effect";
import type { McpConnection, McpToolInfo } from "./mcp-client";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  type GoogleWorkspacePluginId,
} from "./google-workspace-binding";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

const JsonSchema: Schema.Codec<Json, Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonSchema),
    Schema.Record(Schema.String, JsonSchema),
  ]),
);
const decodeJson = Schema.decodeUnknownSync(JsonSchema);

type ToolArguments = {
  query?: string;
  max_results?: number;
  page_token?: string;
  thread_id?: string;
  message_id?: string;
  calendar_id?: string;
  time_min?: string;
  time_max?: string;
  event_id?: string;
  calendar_ids?: readonly string[];
};

const ToolArgumentsSchema = Schema.Struct({
  query: Schema.optional(Schema.String),
  max_results: Schema.optional(Schema.Number),
  page_token: Schema.optional(Schema.String),
  thread_id: Schema.optional(Schema.String),
  message_id: Schema.optional(Schema.String),
  calendar_id: Schema.optional(Schema.String),
  time_min: Schema.optional(Schema.String),
  time_max: Schema.optional(Schema.String),
  event_id: Schema.optional(Schema.String),
  calendar_ids: Schema.optional(Schema.Array(Schema.String)),
});
const decodeToolArguments = Schema.decodeUnknownSync(ToolArgumentsSchema);

type RestRequest = {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
  body?: Json;
};

type ToolSchemaProperties = NonNullable<McpToolInfo["inputSchema"]["properties"]>;
type ToolSchemaProperty = ToolSchemaProperties[string];
type ObjectInputSchema = McpToolInfo["inputSchema"] & {
  type: "object";
  properties: ToolSchemaProperties;
  required?: string[];
  additionalProperties: false;
};

type RestToolSpec = {
  name: string;
  description: string;
  inputSchema: ObjectInputSchema;
  build: (args: ToolArguments) => RestRequest;
  project?: (payload: Json) => ProjectedPayload;
};

export class GoogleRestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function objectSchema(
  properties: ToolSchemaProperties,
  required: string[] = [],
): ObjectInputSchema {
  const schema: ObjectInputSchema = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length) schema.required = required;
  return schema;
}

const stringProperty = (description: string): ToolSchemaProperty => ({
  type: "string",
  description,
});
const numberProperty = (description: string): ToolSchemaProperty => ({
  type: "number",
  description,
});

type TextArgumentKey = Exclude<keyof ToolArguments, "max_results" | "calendar_ids">;

function text(args: ToolArguments, key: TextArgumentKey): string | undefined {
  const value = args[key]?.trim();
  return value || undefined;
}

function requiredText(args: ToolArguments, key: TextArgumentKey): string {
  const value = text(args, key);
  if (!value) throw new GoogleRestError(400, `"${key}" is required`);
  return value;
}

function count(args: ToolArguments, fallback: number): string {
  const value = args.max_results;
  if (value === undefined || !Number.isFinite(value)) return String(fallback);
  return String(Math.max(1, Math.min(500, Math.trunc(value))));
}

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

type GmailHeader = { name?: string; value?: string };
type GmailBody = { data?: string };
type GmailPart = {
  mimeType?: string;
  body?: GmailBody;
  parts?: readonly GmailPart[];
  headers?: readonly GmailHeader[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  labelIds?: readonly string[];
  snippet?: string;
  payload?: GmailPart;
};

const GmailHeaderSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
});
const GmailBodySchema = Schema.Struct({ data: Schema.optional(Schema.String) });
const GmailPartSchema: Schema.Codec<GmailPart, GmailPart> = Schema.suspend(() =>
  Schema.Struct({
    mimeType: Schema.optional(Schema.String),
    body: Schema.optional(GmailBodySchema),
    parts: Schema.optional(Schema.Array(GmailPartSchema)),
    headers: Schema.optional(Schema.Array(GmailHeaderSchema)),
  }),
);
const GmailMessageSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
  labelIds: Schema.optional(Schema.Array(Schema.String)),
  snippet: Schema.optional(Schema.String),
  payload: Schema.optional(GmailPartSchema),
});
const GmailThreadSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  messages: Schema.optional(Schema.Array(GmailMessageSchema)),
});
const decodeGmailMessage = Schema.decodeUnknownSync(GmailMessageSchema);
const decodeGmailThread = Schema.decodeUnknownSync(GmailThreadSchema);
interface MessageHeaders {
  [name: string]: string;
}

type ProjectedMessage = {
  id?: string;
  threadId?: string;
  labelIds?: readonly string[];
  snippet?: string;
  headers: MessageHeaders;
  body: string;
};
type ProjectedThread = { id?: string; messages: ProjectedMessage[] };
type ProjectedPayload = Json | ProjectedMessage | ProjectedThread;

function messageBody(payload: GmailPart | undefined, wanted: string): string {
  if (!payload) return "";
  const data = payload.body?.data ?? "";
  if (payload.mimeType === wanted && data) return decodeBase64Url(data);
  for (const part of payload.parts ?? []) {
    const found = messageBody(part, wanted);
    if (found) return found;
  }
  return "";
}

const KEPT_HEADERS = new Set(["from", "to", "cc", "subject", "date", "reply-to"]);

function messageHeaders(payload: GmailPart | undefined): MessageHeaders {
  const kept: MessageHeaders = {};
  for (const header of payload?.headers ?? []) {
    const name = header.name?.toLowerCase() ?? "";
    const value = header.value ?? "";
    if (name && value && KEPT_HEADERS.has(name)) kept[name] = value;
  }
  return kept;
}

function projectDecodedMessage(message: GmailMessage): ProjectedMessage {
  const plain =
    messageBody(message.payload, "text/plain") || messageBody(message.payload, "text/html");
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    snippet: message.snippet,
    headers: messageHeaders(message.payload),
    body: plain || message.snippet || "",
  };
}

function projectMessage(value: Json): ProjectedMessage {
  return projectDecodedMessage(decodeGmailMessage(value));
}

function projectThread(value: Json): ProjectedThread {
  const thread = decodeGmailThread(value);
  return { id: thread.id, messages: (thread.messages ?? []).map(projectDecodedMessage) };
}

const GMAIL_TOOLS: RestToolSpec[] = [
  {
    name: "list_labels",
    description: "List the labels in the connected Gmail account.",
    inputSchema: objectSchema({}),
    build: () => ({ path: "/users/me/labels" }),
  },
  {
    name: "search_threads",
    description:
      "Search mail threads with Gmail query syntax (for example `from:ana has:attachment newer_than:7d`).",
    inputSchema: objectSchema({
      query: stringProperty("Gmail search query."),
      max_results: numberProperty("Maximum threads to return (default 20)."),
      page_token: stringProperty("Continuation token from a previous search."),
    }),
    build: (args) => ({
      path: "/users/me/threads",
      query: {
        q: text(args, "query"),
        maxResults: count(args, 20),
        pageToken: text(args, "page_token"),
      },
    }),
  },
  {
    name: "get_thread",
    description: "Read one mail thread, including the decoded text of every message in it.",
    inputSchema: objectSchema({ thread_id: stringProperty("Thread id.") }, ["thread_id"]),
    build: (args) => ({
      path: `/users/me/threads/${encodeURIComponent(requiredText(args, "thread_id"))}`,
      query: { format: "full" },
    }),
    project: projectThread,
  },
  {
    name: "get_message",
    description: "Read one mail message, including its decoded text body.",
    inputSchema: objectSchema({ message_id: stringProperty("Message id.") }, ["message_id"]),
    build: (args) => ({
      path: `/users/me/messages/${encodeURIComponent(requiredText(args, "message_id"))}`,
      query: { format: "full" },
    }),
    project: projectMessage,
  },
  {
    name: "list_drafts",
    description: "List saved drafts in the connected Gmail account.",
    inputSchema: objectSchema({
      max_results: numberProperty("Maximum drafts to return (default 20)."),
    }),
    build: (args) => ({
      path: "/users/me/drafts",
      query: { maxResults: count(args, 20) },
    }),
  },
];

const CALENDAR_TOOLS: RestToolSpec[] = [
  {
    name: "list_calendars",
    description: "List the calendars the connected account can read.",
    inputSchema: objectSchema({}),
    build: () => ({ path: "/users/me/calendarList" }),
  },
  {
    name: "list_events",
    description: "List events on a calendar within a time window.",
    inputSchema: objectSchema({
      calendar_id: stringProperty("Calendar id (default `primary`)."),
      time_min: stringProperty("RFC 3339 lower bound."),
      time_max: stringProperty("RFC 3339 upper bound."),
      query: stringProperty("Free-text search over event fields."),
      max_results: numberProperty("Maximum events to return (default 50)."),
    }),
    build: (args) => ({
      path: `/calendars/${encodeURIComponent(text(args, "calendar_id") ?? "primary")}/events`,
      query: {
        timeMin: text(args, "time_min"),
        timeMax: text(args, "time_max"),
        q: text(args, "query"),
        maxResults: count(args, 50),
        singleEvents: "true",
        orderBy: "startTime",
      },
    }),
  },
  {
    name: "get_event",
    description: "Read one calendar event.",
    inputSchema: objectSchema(
      {
        calendar_id: stringProperty("Calendar id (default `primary`)."),
        event_id: stringProperty("Event id."),
      },
      ["event_id"],
    ),
    build: (args) => ({
      path: `/calendars/${encodeURIComponent(text(args, "calendar_id") ?? "primary")}/events/${encodeURIComponent(requiredText(args, "event_id"))}`,
    }),
  },
  {
    name: "suggest_time",
    description:
      "Return the busy intervals for the given calendars and window, so free slots can be chosen from what is left.",
    inputSchema: objectSchema(
      {
        time_min: stringProperty("RFC 3339 start of the window."),
        time_max: stringProperty("RFC 3339 end of the window."),
        calendar_ids: {
          type: "array",
          items: { type: "string" },
          description: "Calendars to inspect (default `primary`).",
        },
      },
      ["time_min", "time_max"],
    ),
    build: (args) => {
      const calendars = (args.calendar_ids ?? []).filter(Boolean);
      return {
        method: "POST",
        path: "/freeBusy",
        body: {
          timeMin: requiredText(args, "time_min"),
          timeMax: requiredText(args, "time_max"),
          items: (calendars.length ? calendars : ["primary"]).map((id) => ({ id })),
        },
      };
    },
  },
];

const TOOLS = {
  gmail: GMAIL_TOOLS,
  "google-calendar": CALENDAR_TOOLS,
} satisfies Record<GoogleWorkspacePluginId, RestToolSpec[]>;

function toolInfo(spec: RestToolSpec): McpToolInfo {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  };
}

function requestUrl(base: string, request: RestRequest): string {
  const url = new URL(`${base}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

const GoogleErrorResponseSchema = Schema.Struct({
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
});
const decodeGoogleErrorResponse = Schema.decodeUnknownOption(GoogleErrorResponseSchema);

async function errorMessage(response: Response): Promise<string> {
  const decoded = decodeGoogleErrorResponse(await response.json().catch(() => null));
  const message = Option.match(decoded, {
    onNone: () => "",
    onSome: (body) => body.error?.message ?? "",
  });
  return message || `Google returned ${response.status}`;
}

export type GoogleRestConnectionInput = {
  service: GoogleWorkspacePluginId;
  authorize: (forceRefresh: boolean) => Promise<Record<string, string>>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
};

export function createGoogleRestConnection(input: GoogleRestConnectionInput): McpConnection {
  const base = GOOGLE_WORKSPACE_BINDINGS[input.service].restEndpoint;
  const send = input.fetch ?? fetch;
  let closed = false;

  const signal = (): AbortSignal => {
    const timeout = AbortSignal.timeout(input.requestTimeoutMs ?? 30_000);
    return input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
  };

  const call = async (request: RestRequest, forceRefresh: boolean): Promise<Response> => {
    const headers = new Headers(await input.authorize(forceRefresh));
    if (request.body !== undefined) headers.set("content-type", "application/json");
    const init: RequestInit = {
      method: request.method ?? "GET",
      headers,
      redirect: "error",
      signal: signal(),
    };
    if (request.body !== undefined) init.body = JSON.stringify(request.body);
    return send(requestUrl(base, request), init);
  };

  return {
    listTools: () => Promise.resolve(TOOLS[input.service].map(toolInfo)),
    async callTool(name, args) {
      if (closed) throw new GoogleRestError(499, "Google connection is closed");
      const spec = TOOLS[input.service].find((candidate) => candidate.name === name);
      if (!spec) throw new GoogleRestError(404, `Unknown tool "${name}"`);
      const request = spec.build(decodeToolArguments(args ?? {}));
      let response = await call(request, false);
      if (response.status === 401) response = await call(request, true);
      if (!response.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `${name} failed: ${await errorMessage(response)}` }],
        };
      }
      const payload = decodeJson(await response.json().catch(() => null));
      const projected = spec.project ? spec.project(payload) : payload;
      return { content: [{ type: "text", text: JSON.stringify(projected, null, 2) }] };
    },
    close() {
      closed = true;
    },
  };
}
