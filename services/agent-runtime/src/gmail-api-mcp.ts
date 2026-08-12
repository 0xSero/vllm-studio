import { Schema } from "effect";
import type { McpConnection, McpToolInfo } from "./mcp-client";

type GmailAuthorize = (forceRefresh: boolean) => Promise<Record<string, string>>;

const HeaderSchema = Schema.Struct({ name: Schema.String, value: Schema.String });
const BodySchema = Schema.Struct({
  attachmentId: Schema.optional(Schema.String),
  data: Schema.optional(Schema.String),
});
const PartSchema = Schema.Struct({
  body: Schema.optional(BodySchema),
  filename: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Array(HeaderSchema)),
  mimeType: Schema.optional(Schema.String),
  parts: Schema.optional(Schema.Array(Schema.Unknown)),
});
const MessageSchema = Schema.Struct({
  id: Schema.String,
  internalDate: Schema.optional(Schema.String),
  labelIds: Schema.optional(Schema.Array(Schema.String)),
  payload: Schema.optional(PartSchema),
  snippet: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
});
const ThreadSchema = Schema.Struct({
  id: Schema.String,
  messages: Schema.optional(Schema.Array(MessageSchema)),
});
const ThreadListSchema = Schema.Struct({
  nextPageToken: Schema.optional(Schema.String),
  resultSizeEstimate: Schema.optional(Schema.Number),
  threads: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String }))),
});
const DraftListSchema = Schema.Struct({
  drafts: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.String, message: Schema.optional(MessageSchema) })),
  ),
  nextPageToken: Schema.optional(Schema.String),
});
const DraftSchema = Schema.Struct({ id: Schema.String, message: MessageSchema });
const LabelSchema = Schema.Struct({
  color: Schema.optional(
    Schema.Struct({
      backgroundColor: Schema.optional(Schema.String),
      textColor: Schema.optional(Schema.String),
    }),
  ),
  id: Schema.String,
  messagesTotal: Schema.optional(Schema.Number),
  messagesUnread: Schema.optional(Schema.Number),
  name: Schema.String,
  threadsTotal: Schema.optional(Schema.Number),
  threadsUnread: Schema.optional(Schema.Number),
});
const LabelsSchema = Schema.Struct({ labels: Schema.optional(Schema.Array(LabelSchema)) });

const MessageFormatSchema = Schema.Union([
  Schema.Literal("MESSAGE_FORMAT_UNSPECIFIED"),
  Schema.Literal("MINIMAL"),
  Schema.Literal("FULL_CONTENT"),
  Schema.Literal("METADATA_ONLY"),
  Schema.Literal("PLAIN_TEXT"),
]);
const GetMessageArgsSchema = Schema.Struct({
  messageFormat: Schema.optional(MessageFormatSchema),
  messageId: Schema.String,
});
const GetThreadArgsSchema = Schema.Struct({
  messageFormat: Schema.optional(MessageFormatSchema),
  threadId: Schema.String,
});
const SearchThreadsArgsSchema = Schema.Struct({
  includeTrash: Schema.optional(Schema.Boolean),
  pageSize: Schema.optional(Schema.Number),
  pageToken: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  view: Schema.optional(
    Schema.Union([
      Schema.Literal("THREAD_VIEW_UNSPECIFIED"),
      Schema.Literal("THREAD_VIEW_METADATA_ONLY"),
      Schema.Literal("THREAD_VIEW_MINIMAL"),
    ]),
  ),
});
const ListDraftsArgsSchema = Schema.Struct({
  pageSize: Schema.optional(Schema.Number),
  pageToken: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  view: Schema.optional(
    Schema.Union([
      Schema.Literal("DRAFT_VIEW_UNSPECIFIED"),
      Schema.Literal("DRAFT_VIEW_METADATA_ONLY"),
      Schema.Literal("DRAFT_VIEW_FULL"),
    ]),
  ),
});

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
};

const GMAIL_TOOLS: McpToolInfo[] = [
  {
    name: "list_drafts",
    description: "List draft emails from Gmail with optional search and pagination.",
    inputSchema: {
      type: "object",
      properties: {
        pageSize: { type: "number" },
        pageToken: { type: "string" },
        query: { type: "string" },
        view: {
          type: "string",
          enum: ["DRAFT_VIEW_UNSPECIFIED", "DRAFT_VIEW_METADATA_ONLY", "DRAFT_VIEW_FULL"],
        },
      },
    },
    annotations: { ...readOnlyAnnotations, title: "List draft emails" },
  },
  {
    name: "get_thread",
    description: "Get an email thread and its messages by thread ID.",
    inputSchema: {
      type: "object",
      properties: {
        messageFormat: {
          type: "string",
          enum: [
            "MESSAGE_FORMAT_UNSPECIFIED",
            "MINIMAL",
            "FULL_CONTENT",
            "METADATA_ONLY",
            "PLAIN_TEXT",
          ],
        },
        threadId: { type: "string" },
      },
      required: ["threadId"],
    },
    annotations: { ...readOnlyAnnotations, title: "Get email thread" },
  },
  {
    name: "get_message",
    description: "Get an individual email message by message ID.",
    inputSchema: {
      type: "object",
      properties: {
        messageFormat: {
          type: "string",
          enum: [
            "MESSAGE_FORMAT_UNSPECIFIED",
            "MINIMAL",
            "FULL_CONTENT",
            "METADATA_ONLY",
            "PLAIN_TEXT",
          ],
        },
        messageId: { type: "string" },
      },
      required: ["messageId"],
    },
    annotations: { ...readOnlyAnnotations, title: "Get email message" },
  },
  {
    name: "search_threads",
    description: "Search Gmail threads using Gmail search syntax.",
    inputSchema: {
      type: "object",
      properties: {
        includeTrash: { type: "boolean" },
        pageSize: { type: "number" },
        pageToken: { type: "string" },
        query: { type: "string" },
        view: {
          type: "string",
          enum: ["THREAD_VIEW_UNSPECIFIED", "THREAD_VIEW_METADATA_ONLY", "THREAD_VIEW_MINIMAL"],
        },
      },
    },
    annotations: { ...readOnlyAnnotations, title: "Search email threads" },
  },
  {
    name: "list_labels",
    description: "List all labels in the authenticated Gmail account.",
    inputSchema: { type: "object", properties: {} },
    annotations: { ...readOnlyAnnotations, title: "List labels" },
  },
];

const gmailUrl = (path: string, params?: URLSearchParams): string => {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  if (params) url.search = params.toString();
  return url.toString();
};

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(15_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function gmailJson<A>(
  url: string,
  decode: (input: unknown) => A,
  authorize: GmailAuthorize,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<A> {
  const send = async (forceRefresh: boolean): Promise<Response> => {
    const headers = new Headers(await authorize(forceRefresh));
    headers.set("accept", "application/json");
    return fetcher(url, { headers, signal: requestSignal(signal) });
  };
  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (!response.ok) throw new Error(`Gmail API request failed with status ${response.status}`);
  try {
    return decode(await response.json());
  } catch {
    throw new Error("Gmail API returned invalid data");
  }
}

function boundedPageSize(value: number | undefined): string {
  return String(Math.max(1, Math.min(50, Math.floor(value ?? 20))));
}

function decodeBase64Url(value: string | undefined): string {
  if (!value) return "";
  return Buffer.from(value, "base64url").toString("utf8");
}

function allParts(input: typeof PartSchema.Type | undefined): Array<typeof PartSchema.Type> {
  if (!input) return [];
  const nested = (input.parts ?? []).flatMap((part) =>
    allParts(Schema.decodeUnknownSync(PartSchema)(part)),
  );
  return [input, ...nested];
}

function header(message: typeof MessageSchema.Type, name: string): string {
  const value = message.payload?.headers?.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  )?.value;
  return value?.trim() ?? "";
}

function recipients(value: string): string[] {
  return value
    .split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function messageDate(message: typeof MessageSchema.Type): string {
  const value = header(message, "Date");
  const parsed = value ? new Date(value) : new Date(Number(message.internalDate ?? 0));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function htmlPlainText(value: string): string {
  let output = "";
  let tag = "";
  let quote: '"' | "'" | null = null;
  let insideTag = false;
  for (const character of value) {
    if (!insideTag) {
      if (character === "<") {
        insideTag = true;
        tag = "";
      } else if (character === "&") {
        output += "&amp;";
      } else if (character === ">") {
        output += "&gt;";
      } else {
        output += character;
      }
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      tag += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tag += character;
      continue;
    }
    if (character === ">") {
      if (/^\s*br\b/i.test(tag) || /^\s*\/\s*p\b/i.test(tag)) output += "\n";
      insideTag = false;
      tag = "";
      continue;
    }
    tag += character;
  }
  return output.replace(/&amp;(?:nbsp|#160);/gi, " ");
}

function plainText(message: typeof MessageSchema.Type): string {
  const parts = allParts(message.payload);
  const text = parts.find((part) => part.mimeType === "text/plain" && part.body?.data);
  if (text?.body?.data) return decodeBase64Url(text.body.data);
  const html = parts.find((part) => part.mimeType === "text/html" && part.body?.data);
  return htmlPlainText(decodeBase64Url(html?.body?.data));
}

function renderedMessage(
  message: typeof MessageSchema.Type,
  format: typeof MessageFormatSchema.Type | undefined,
) {
  const parts = allParts(message.payload);
  const full = !format || format === "MESSAGE_FORMAT_UNSPECIFIED" || format === "FULL_CONTENT";
  const includeText = full || format === "PLAIN_TEXT";
  const minimal = format !== "METADATA_ONLY";
  return {
    id: message.id,
    ...(message.threadId ? { threadId: message.threadId } : {}),
    sender: header(message, "From"),
    toRecipients: recipients(header(message, "To")),
    ccRecipients: recipients(header(message, "Cc")),
    bccRecipients: recipients(header(message, "Bcc")),
    date: messageDate(message),
    labelIds: [...(message.labelIds ?? [])],
    ...(minimal ? { snippet: message.snippet ?? "", subject: header(message, "Subject") } : {}),
    ...(includeText ? { plaintextBody: plainText(message) } : {}),
    ...(full
      ? {
          htmlBody: decodeBase64Url(
            parts.find((part) => part.mimeType === "text/html" && part.body?.data)?.body?.data,
          ),
        }
      : {}),
    ...(includeText
      ? {
          attachmentIds: parts.flatMap((part) =>
            part.body?.attachmentId ? [part.body.attachmentId] : [],
          ),
          attachments: parts.flatMap((part) =>
            part.body?.attachmentId
              ? [
                  {
                    id: part.body.attachmentId,
                    filename: part.filename ?? "",
                    mimeType: part.mimeType ?? "application/octet-stream",
                  },
                ]
              : [],
          ),
        }
      : {}),
  };
}

function toolResult(value: Record<string, unknown>): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

class GmailApiConnection implements McpConnection {
  constructor(
    private readonly authorize: GmailAuthorize,
    private readonly signal?: AbortSignal,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listTools(): Promise<McpToolInfo[]> {
    return GMAIL_TOOLS;
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    if (name === "list_labels") return this.listLabels();
    if (name === "get_message") return this.getMessage(input);
    if (name === "get_thread") return this.getThread(input);
    if (name === "search_threads") return this.searchThreads(input);
    if (name === "list_drafts") return this.listDrafts(input);
    throw new Error(`Unknown Gmail tool "${name}"`);
  }

  close(): void {}

  private request<A>(url: string, decode: (input: unknown) => A): Promise<A> {
    return gmailJson(url, decode, this.authorize, this.signal, this.fetcher);
  }

  private async listLabels(): Promise<unknown> {
    const result = await this.request(gmailUrl("labels"), Schema.decodeUnknownSync(LabelsSchema));
    return toolResult({
      labels: (result.labels ?? []).map((label) => ({
        labelId: label.id,
        name: label.name,
        ...(label.color ? { color: label.color } : {}),
        ...(label.messagesTotal === undefined ? {} : { messagesTotal: label.messagesTotal }),
        ...(label.messagesUnread === undefined ? {} : { messagesUnread: label.messagesUnread }),
        ...(label.threadsTotal === undefined ? {} : { threadsTotal: label.threadsTotal }),
        ...(label.threadsUnread === undefined ? {} : { threadsUnread: label.threadsUnread }),
      })),
    });
  }

  private async getMessage(input: Record<string, unknown>): Promise<unknown> {
    const args = Schema.decodeUnknownSync(GetMessageArgsSchema)(input);
    const message = await this.request(
      gmailUrl(`messages/${encodeURIComponent(args.messageId)}`, new URLSearchParams({ format: "full" })),
      Schema.decodeUnknownSync(MessageSchema),
    );
    return toolResult(renderedMessage(message, args.messageFormat));
  }

  private async getThread(input: Record<string, unknown>): Promise<unknown> {
    const args = Schema.decodeUnknownSync(GetThreadArgsSchema)(input);
    const thread = await this.request(
      gmailUrl(`threads/${encodeURIComponent(args.threadId)}`, new URLSearchParams({ format: "full" })),
      Schema.decodeUnknownSync(ThreadSchema),
    );
    return toolResult({
      id: thread.id,
      messages: (thread.messages ?? []).map((message) =>
        renderedMessage(message, args.messageFormat),
      ),
    });
  }

  private async searchThreads(input: Record<string, unknown>): Promise<unknown> {
    const args = Schema.decodeUnknownSync(SearchThreadsArgsSchema)(input);
    const params = new URLSearchParams({ maxResults: boundedPageSize(args.pageSize) });
    if (args.query) params.set("q", args.query);
    if (args.pageToken) params.set("pageToken", args.pageToken);
    if (args.includeTrash) params.set("includeSpamTrash", "true");
    const result = await this.request(
      gmailUrl("threads", params),
      Schema.decodeUnknownSync(ThreadListSchema),
    );
    const format = args.view === "THREAD_VIEW_METADATA_ONLY" ? "METADATA_ONLY" : "MINIMAL";
    const threads = await Promise.all(
      (result.threads ?? []).map((thread) =>
        this.request(
          gmailUrl(`threads/${encodeURIComponent(thread.id)}`, new URLSearchParams({ format: "full" })),
          Schema.decodeUnknownSync(ThreadSchema),
        ),
      ),
    );
    return toolResult({
      threads: threads.map((thread) => ({
        id: thread.id,
        messages: (thread.messages ?? []).map((message) => renderedMessage(message, format)),
      })),
      resultCountEstimate: String(result.resultSizeEstimate ?? threads.length),
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    });
  }

  private async listDrafts(input: Record<string, unknown>): Promise<unknown> {
    const args = Schema.decodeUnknownSync(ListDraftsArgsSchema)(input);
    const params = new URLSearchParams({ maxResults: boundedPageSize(args.pageSize) });
    if (args.query) params.set("q", args.query);
    if (args.pageToken) params.set("pageToken", args.pageToken);
    const result = await this.request(
      gmailUrl("drafts", params),
      Schema.decodeUnknownSync(DraftListSchema),
    );
    const drafts = await Promise.all(
      (result.drafts ?? []).map((draft) =>
        this.request(
          gmailUrl(`drafts/${encodeURIComponent(draft.id)}`, new URLSearchParams({ format: "full" })),
          Schema.decodeUnknownSync(DraftSchema),
        ),
      ),
    );
    const format = args.view === "DRAFT_VIEW_FULL" ? "FULL_CONTENT" : "METADATA_ONLY";
    return toolResult({
      drafts: drafts.map((draft) => {
        const { id: _messageId, ...message } = renderedMessage(draft.message, format);
        return { id: draft.id, ...message };
      }),
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    });
  }
}

export function connectGmailApi(
  authorize: GmailAuthorize,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): McpConnection {
  return new GmailApiConnection(authorize, signal, fetcher);
}

export async function verifyGmailApiAccess(
  accessToken: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await gmailJson(
    gmailUrl("labels"),
    Schema.decodeUnknownSync(LabelsSchema),
    async () => ({ Authorization: `Bearer ${accessToken}` }),
    signal,
    fetcher,
  );
}
