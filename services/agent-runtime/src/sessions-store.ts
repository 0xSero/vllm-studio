import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Schema } from "effect";
import { getAgentDir, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolveDataDir } from "./data-dir";
import { expandHome } from "./pi-runtime-helpers";
import { rolloutCache, statRollout } from "./rollout-cache";
import { transcriptSource } from "./transcript-sidecar";
import { cleanSessionTitle, sessionTitleFromUserPrompt } from "../../../shared/agent/session-title";
import { readSessionListMetadata } from "./session-metadata-store";
import type { SessionSummary } from "../../../shared/agent/session-summary";
import { emptyUsageTotals, readSessionUsageTotals, type SessionUsageTotals } from "./session-usage";
export type { SessionSummary } from "../../../shared/agent/session-summary";

const SessionEventSchema = Schema.Record(Schema.String, Schema.Unknown);
const MessageSchema = Schema.Struct({
  role: Schema.optional(Schema.String),
  content: Schema.optional(
    Schema.Union([
      Schema.String,
      Schema.Array(
        Schema.Struct({
          type: Schema.optional(Schema.String),
          text: Schema.optional(Schema.String),
        }),
      ),
    ]),
  ),
  timestamp: Schema.optional(Schema.String),
});
export type SessionEvent = typeof SessionEventSchema.Type;
const isSessionEvent = Schema.is(SessionEventSchema);
const isMessage = Schema.is(MessageSchema);
const isString = Schema.is(Schema.String);

type ListSessionsOptions = {
  since?: Date;
  ids?: string[];
  includeArchived?: boolean;
  archivedOnly?: boolean;
  limit?: number;
};

type NormalizedListSessionsOptions = {
  sinceMs?: number;
  wantedIds: Set<string>;
  wantedIdList: string[];
  includeArchived: boolean;
  archivedOnly: boolean;
};

type PiMessageContent = string | readonly { type?: string; text?: string }[];

type UserTurn = {
  isUser: boolean;
  text: string | null;
  at: string | null;
};

function summaryStartTime(session: Pick<SessionSummary, "startedAt" | "updatedAt">): number {
  const value = Date.parse(session.startedAt || session.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

export function encodeCwdForPi(cwd: string): string {
  const normalized = path.resolve(cwd).replace(/\\+/g, "/");
  const collapsed = normalized.replace(/^\//, "").replace(/\/+/g, "-");
  return `--${collapsed}--`;
}

export function configuredPiSessionDir(cwd: string): string | undefined {
  const envSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (envSessionDir) {
    return path.resolve(expandHome(envSessionDir));
  }
  return SettingsManager.create(cwd, getAgentDir()).getSessionDir();
}

function cwdVariants(cwd: string): string[] {
  const variants = [path.resolve(cwd)];
  try {
    variants.push(realpathSync.native(cwd));
  } catch {
    try {
      variants.push(realpathSync(cwd));
    } catch {}
  }
  return [...new Set(variants.map((value) => path.resolve(value)))];
}

function sessionsDirsForCwd(cwd: string): string[] {
  const encodedCwds = [...new Set(cwdVariants(cwd).map(encodeCwdForPi))];
  const nativeDir = configuredPiSessionDir(cwd) ?? SessionManager.create(cwd).getSessionDir();
  const legacyRoot = path.join(resolveDataDir(), "pi-agent", "sessions");
  const dirs = [
    path.resolve(nativeDir),
    ...encodedCwds.map((encoded) => path.join(legacyRoot, encoded)),
  ];
  return dirs.filter((value, index, values) => values.indexOf(value) === index);
}

export function sessionDirRootsForCwd(cwd: string): string[] {
  return [...new Set(sessionsDirsForCwd(cwd).map((dir) => path.dirname(dir)))];
}

function sessionCwdMatches(summaryCwd: string, cwd: string): boolean {
  if (!summaryCwd) return false;
  const expected = new Set(cwdVariants(cwd));
  return cwdVariants(summaryCwd).some((candidate) => expected.has(candidate));
}

function piTextContent(content: PiMessageContent | undefined): string | null {
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === "text" && isString(part.text))
      .map((part) => part.text)
      .join(" ")
      .trim();
    return text || null;
  }
  if (!isString(content)) return null;
  const text = content.trim();
  return text || null;
}

function userEventTimestamp(event: SessionEvent): string | null {
  if (isString(event.timestamp) && event.timestamp) return event.timestamp;
  const message = isMessage(event.message) ? event.message : undefined;
  return message?.timestamp || null;
}

function userTurnFromEvent(event: SessionEvent): UserTurn {
  if (event.type === "user_message") {
    const content = Schema.is(MessageSchema.fields.content)(event.content)
      ? event.content
      : undefined;
    return { isUser: true, text: piTextContent(content), at: userEventTimestamp(event) };
  }
  if (event.type !== "message" && event.type !== "message_end")
    return { isUser: false, text: null, at: null };
  const message = isMessage(event.message) ? event.message : undefined;
  if (message?.role !== "user") return { isUser: false, text: null, at: null };
  return { isUser: true, text: piTextContent(message.content), at: userEventTimestamp(event) };
}

const SUMMARY_SCAN_LINE_CAP = 2000;

type SummaryCacheEntry = {
  mtimeMs: number;
  core: Omit<
    SessionSummary,
    "updatedAt" | "archived" | "archivedAt" | "parentSessionId" | "subagentName"
  > | null;
};
const summaryCache = new Map<string, SummaryCacheEntry>();
const SUMMARY_CACHE_MAX_ENTRIES = 8192;

function summaryFromCore(core: SummaryCacheEntry["core"], mtime: Date): SessionSummary | null {
  if (!core) return null;
  return {
    ...core,
    updatedAt: mtime.toISOString(),
    archived: false,
    archivedAt: null,
    parentSessionId: null,
    subagentName: null,
  };
}

function rememberSummary(filepath: string, entry: SummaryCacheEntry): void {
  summaryCache.delete(filepath);
  summaryCache.set(filepath, entry);
  while (summaryCache.size > SUMMARY_CACHE_MAX_ENTRIES) {
    const oldest = summaryCache.keys().next().value;
    if (oldest === undefined) break;
    summaryCache.delete(oldest);
  }
}

async function readLastUserTurn(filepath: string): Promise<{ text: string; at: string } | null> {
  const transcript = await transcriptSource(filepath);
  if (!transcript.size) return null;
  const { events } = readTailRegion(transcript.filepath, transcript.size, 1, undefined);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const turn = userTurnFromEvent(events[index]);
    if (turn.isUser && turn.text && turn.at) return { text: turn.text, at: turn.at };
  }
  return null;
}

async function scanSessionSummary(filepath: string) {
  let header: SessionEvent | null = null;
  let firstUserMessage: string | null = null;
  const stream = createReadStream(filepath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let scanned = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      scanned += 1;
      let event: SessionEvent;
      try {
        const parsed = JSON.parse(line);
        if (!isSessionEvent(parsed)) continue;
        event = parsed;
      } catch {
        continue;
      }
      if (!header && event.type === "session") header = event;
      if (!firstUserMessage) {
        const userTurn = userTurnFromEvent(event);
        if (userTurn.isUser && userTurn.text) {
          firstUserMessage =
            cleanSessionTitle(sessionTitleFromUserPrompt(userTurn.text).slice(0, 120)) || null;
        }
      }
      if (header && firstUserMessage) break;
      if (scanned >= SUMMARY_SCAN_LINE_CAP) break;
    }
  } finally {
    stream.destroy();
  }
  return { header, firstUserMessage };
}

async function readSessionSummary(
  filepath: string,
  filename: string,
): Promise<SessionSummary | null> {
  const stats = statSync(filepath);
  const cached = summaryCache.get(filepath);
  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return summaryFromCore(cached.core, stats.mtime);
  }
  const { header, firstUserMessage } = await scanSessionSummary(filepath);

  let lastUserPromptText: string | undefined;
  let lastUserPromptAt: string | undefined;
  if (header && firstUserMessage) {
    const lastTurn = await readLastUserTurn(filepath);
    if (lastTurn) {
      const visible = sessionTitleFromUserPrompt(lastTurn.text);
      if (visible) lastUserPromptText = visible;
      lastUserPromptAt = lastTurn.at;
    }
  }

  let core: SummaryCacheEntry["core"] = null;
  if (header) {
    core = {
      id: isString(header.id) ? header.id : "",
      filename,
      cwd: isString(header.cwd) ? header.cwd : "",
      startedAt: isString(header.timestamp) ? header.timestamp : stats.birthtime.toISOString(),
      modelId: isString(header.modelId) ? header.modelId : null,
      provider: isString(header.provider) ? header.provider : null,
      firstUserMessage,
    };
    if (lastUserPromptText !== undefined) core.lastUserPromptText = lastUserPromptText;
    if (lastUserPromptAt !== undefined) core.lastUserPromptAt = lastUserPromptAt;
  }
  rememberSummary(filepath, { mtimeMs: stats.mtimeMs, core });
  return summaryFromCore(core, stats.mtime);
}

type SessionMetadataLookup = ReturnType<typeof readSessionListMetadata>;

function applySessionMetadata(
  summary: SessionSummary,
  metadataFor: SessionMetadataLookup,
): SessionSummary {
  return { ...summary, ...metadataFor(summary.id) };
}

function summaryRelevantTime(summary: SessionSummary, archivedOnly: boolean): number {
  const value = archivedOnly
    ? summary.archivedAt || summary.updatedAt || summary.startedAt
    : summary.updatedAt || summary.startedAt;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeListOptions(options: ListSessionsOptions): NormalizedListSessionsOptions {
  const wantedIds = new Set((options.ids ?? []).map((id) => id.trim()).filter(Boolean));
  const sinceMs = options.since?.getTime();
  return {
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : undefined,
    wantedIds,
    wantedIdList: [...wantedIds],
    includeArchived: Boolean(options.includeArchived),
    archivedOnly: Boolean(options.archivedOnly),
  };
}

function summaryMatchesListOptions(
  summary: SessionSummary,
  options: NormalizedListSessionsOptions,
) {
  if (options.archivedOnly) {
    return (
      summary.archived &&
      (options.sinceMs === undefined || summaryRelevantTime(summary, true) >= options.sinceMs)
    );
  }
  return options.includeArchived || !summary.archived;
}

async function readListCandidate(
  cwd: string,
  dir: string,
  filename: string,
  options: NormalizedListSessionsOptions,
  metadataFor: SessionMetadataLookup,
): Promise<SessionSummary | null> {
  try {
    if (!filename.endsWith(".jsonl")) return null;
    if (
      options.wantedIdList.length > 0 &&
      !options.wantedIdList.some((id) => filename.includes(id) || filename.startsWith(id))
    ) {
      return null;
    }
    const filepath = path.join(dir, filename);
    const stats = statSync(filepath);
    if (
      options.sinceMs !== undefined &&
      !options.archivedOnly &&
      stats.mtime.getTime() < options.sinceMs
    ) {
      return null;
    }
    const summary = await readSessionSummary(filepath, filename);
    if (!summary?.id) return null;
    if (!sessionCwdMatches(summary.cwd, cwd)) return null;
    if (options.wantedIds.size > 0 && !options.wantedIds.has(summary.id)) return null;
    const decorated = applySessionMetadata(summary, metadataFor);
    return summaryMatchesListOptions(decorated, options) ? decorated : null;
  } catch {
    return null;
  }
}

function listCandidateFiles(
  cwd: string,
): Array<{ dir: string; filename: string; mtimeMs: number }> {
  const candidates: Array<{ dir: string; filename: string; mtimeMs: number }> = [];
  for (const dir of sessionsDirsForCwd(cwd)) {
    if (!existsSync(dir)) continue;
    for (const filename of readdirSync(dir)) {
      if (!filename.endsWith(".jsonl")) continue;
      try {
        candidates.push({ dir, filename, mtimeMs: statSync(path.join(dir, filename)).mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function limitSatisfied(
  summariesById: Map<string, SessionSummary>,
  limit: number | undefined,
  nextMtimeMs: number,
): boolean {
  if (!limit || summariesById.size < limit) return false;
  const startTimes = [...summariesById.values()].map(summaryStartTime).sort((a, b) => b - a);
  return nextMtimeMs < startTimes[limit - 1];
}

export async function listSessions(
  cwd: string,
  options: ListSessionsOptions = {},
): Promise<SessionSummary[]> {
  const summariesById = new Map<string, SessionSummary>();
  const normalizedOptions = normalizeListOptions(options);
  const metadataFor = readSessionListMetadata();
  for (const candidate of listCandidateFiles(cwd)) {
    if (limitSatisfied(summariesById, options.limit, candidate.mtimeMs)) break;
    const summary = await readListCandidate(
      cwd,
      candidate.dir,
      candidate.filename,
      normalizedOptions,
      metadataFor,
    );
    const existing = summary ? summariesById.get(summary.id) : null;
    if (summary && (!existing || summary.updatedAt > existing.updatedAt)) {
      summariesById.set(summary.id, summary);
    }
  }
  const summaries = [...summariesById.values()];
  summaries.sort((a, b) => summaryStartTime(b) - summaryStartTime(a));
  return options.limit && options.limit > 0 ? summaries.slice(0, options.limit) : summaries;
}

const PI_SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const PI_SESSION_HEADER_BYTE_CAP = 64 * 1024;

function readPiSessionHeader(filepath: string): { id: string; cwd: string } | null {
  let fd: number | null = null;
  try {
    const size = statSync(filepath).size;
    const bytesToRead = Math.min(size, PI_SESSION_HEADER_BYTE_CAP);
    const buffer = Buffer.alloc(bytesToRead);
    fd = openSync(filepath, "r");
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
    const newline = buffer.indexOf(0x0a, 0);
    if (newline < 0 && size > PI_SESSION_HEADER_BYTE_CAP) return null;
    const lineEnd = newline >= 0 ? newline : bytesRead;
    const header = JSON.parse(buffer.toString("utf8", 0, lineEnd));
    if (!isSessionEvent(header) || header.type !== "session" || !isString(header.id)) return null;
    return { id: header.id, cwd: isString(header.cwd) ? header.cwd : "" };
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function findSessionFile(cwd: string, sessionId: string): string | null {
  if (!PI_SESSION_ID_PATTERN.test(sessionId)) return null;

  const filenameSuffix = `_${sessionId}.jsonl`;
  const matches = new Set<string>();
  for (const dir of sessionsDirsForCwd(cwd)) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(filenameSuffix)) continue;
        const filepath = path.join(dir, entry.name);
        const header = readPiSessionHeader(filepath);
        if (header?.id !== sessionId || !sessionCwdMatches(header.cwd, cwd)) continue;
        matches.add(filepath);
        if (matches.size > 1) return null;
      }
    } catch {
      continue;
    }
  }
  return matches.values().next().value ?? null;
}

export type LoadSessionOptions = {
  tail?: number;
  before?: number;
};

export type LoadSessionMeta = {
  title: string | null;
  modelId: string | null;
  startedAt: string | null;
  piSessionId: string | null;
  usage: SessionUsageTotals;
};

export type LoadSessionResult = {
  events: SessionEvent[];
  cursor: number | null;
  meta: LoadSessionMeta | null;
};

const TAIL_SCAN_BYTE_CAP = 96 * 1024 * 1024;
const FULL_READ_BYTE_CAP = 96 * 1024 * 1024;
const TAIL_CHUNK_BYTES = 8 * 1024 * 1024;
const HEAD_SCAN_LINE_CAP = 400;

function parseEvent(line: string): SessionEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const event = JSON.parse(trimmed);
    return isSessionEvent(event) ? event : null;
  } catch {
    return null;
  }
}

const activeBranchDisk = rolloutCache<Set<string>, string[]>("active-branch", {
  serialize: (ids) => [...ids],
  deserialize: (raw) => new Set(raw),
});

function activeBranchIds(filepath: string): Set<string> | null {
  const stat = statRollout(filepath);
  if (!stat) return null;

  const cached = activeBranchDisk.read(filepath, stat);
  if (cached) return cached;

  const ids = new Set(
    SessionManager.open(filepath)
      .buildContextEntries()
      .map((entry) => entry.id),
  );
  activeBranchDisk.write(filepath, stat, ids);
  return ids;
}

function activeBranchEvents(filepath: string, events: SessionEvent[]): SessionEvent[] {
  try {
    const activeIds = activeBranchIds(filepath);
    if (!activeIds) return events;
    return events.filter(
      (event) => event.type === "session" || (isString(event.id) && activeIds.has(event.id)),
    );
  } catch {
    return events;
  }
}

function isInertEvent(event: SessionEvent): boolean {
  return event.type === "custom" || event.type === "custom_message";
}

function isMessageEvent(event: SessionEvent): boolean {
  if (event.type !== "message" && event.type !== "message_end") return false;
  return isMessage(event.message) && isString(event.message.role);
}

function messageRole(event: SessionEvent): string | undefined {
  return isMessage(event.message) ? event.message.role : undefined;
}

function isHeaderEvent(event: SessionEvent): boolean {
  return (
    event.type === "session" ||
    event.type === "model_change" ||
    event.type === "thinking_level_change"
  );
}

const INERT_LINE_PREFIX = Buffer.from('{"type":"custom');

function lineIsInert(bytes: Buffer, start: number, end: number): boolean {
  if (end - start < INERT_LINE_PREFIX.length) return false;
  for (let i = 0; i < INERT_LINE_PREFIX.length; i += 1) {
    if (bytes[start + i] !== INERT_LINE_PREFIX[i]) return false;
  }
  return true;
}

function parseRegion(bytes: Buffer, regionStart: number) {
  const events: Array<{ offset: number; event: SessionEvent }> = [];
  let lineStart = 0;
  let head = Buffer.alloc(0);
  let sawNewline = false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== 0x0a) continue;
    sawNewline = true;
    if (lineStart === 0 && regionStart !== 0) {
      head = Buffer.from(bytes.subarray(0, i + 1));
    } else if (!lineIsInert(bytes, lineStart, i)) {
      const event = parseEvent(bytes.toString("utf8", lineStart, i));
      if (event && !isInertEvent(event)) events.push({ offset: regionStart + lineStart, event });
    }
    lineStart = i + 1;
  }
  if (!sawNewline && regionStart !== 0) head = Buffer.from(bytes);
  return { events, head };
}

function tailBoundaryIndex(
  lines: Array<{ offset: number; event: SessionEvent }>,
  tail: number,
): number {
  let messageCount = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isMessageEvent(lines[i].event)) continue;
    messageCount += 1;
    if (messageCount >= tail && messageRole(lines[i].event) === "user") return i;
  }
  return 0;
}

function headScanComplete(meta: LoadSessionMeta, scanned: number, headerCount: number): boolean {
  return Boolean(meta.title && meta.startedAt && scanned >= headerCount && scanned >= 8);
}

async function readSessionHead(
  filepath: string,
): Promise<{ headerEvents: SessionEvent[]; meta: LoadSessionMeta }> {
  const headerEvents: SessionEvent[] = [];
  const meta: LoadSessionMeta = {
    title: null,
    modelId: null,
    startedAt: null,
    usage: emptyUsageTotals(),
    piSessionId: null,
  };
  const recordHeadEvent = (event: SessionEvent): void => {
    if (isHeaderEvent(event)) headerEvents.push(event);
    if (event.type === "session") {
      if (isString(event.timestamp)) meta.startedAt = event.timestamp;
      const model = [event.modelId, event.model, event.model_id].find(isString);
      if (model) meta.modelId = model;
      if (isString(event.id)) meta.piSessionId = event.id;
    }
    if (event.type === "model_change") {
      const model = [event.model, event.modelId].find(isString);
      if (model) meta.modelId = model;
    }
    if (!meta.title) {
      const userTurn = userTurnFromEvent(event);
      if (userTurn.isUser && userTurn.text) {
        meta.title = cleanSessionTitle(userTurn.text.slice(0, 120)) || null;
      }
    }
  };
  const stream = createReadStream(filepath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let scanned = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      scanned += 1;
      const event = parseEvent(line);
      if (!event) {
        if (scanned >= HEAD_SCAN_LINE_CAP) break;
        continue;
      }
      recordHeadEvent(event);
      if (headScanComplete(meta, scanned, headerEvents.length)) {
        break;
      }
      if (scanned >= HEAD_SCAN_LINE_CAP) break;
    }
  } finally {
    stream.destroy();
  }
  return { headerEvents, meta };
}

function readTailRegion(filepath: string, size: number, tail: number, before: number | undefined) {
  const end = before === undefined ? size : Math.max(0, Math.min(before, size));
  if (end <= 0) return { events: [], cursor: null };
  const fd = openSync(filepath, "r");
  try {
    let regionStart = end;
    let carry: Buffer = Buffer.alloc(0);
    let kept: Array<{ offset: number; event: SessionEvent }> = [];
    while (regionStart > 0 && end - regionStart < TAIL_SCAN_BYTE_CAP) {
      const readLen = Math.min(TAIL_CHUNK_BYTES, regionStart);
      regionStart -= readLen;
      const chunk = Buffer.allocUnsafe(readLen);
      readSync(fd, chunk, 0, readLen, regionStart);
      const combined = carry.length > 0 ? Buffer.concat([chunk, carry]) : chunk;
      const parsed = parseRegion(combined, regionStart);
      kept = parsed.events.length > 0 ? [...parsed.events, ...kept] : kept;
      carry = parsed.head;
      if (regionStart === 0) break;
      const messageCount = kept.reduce(
        (count, line) => (isMessageEvent(line.event) ? count + 1 : count),
        0,
      );
      if (messageCount >= tail && tailBoundaryIndex(kept, tail) > 0) break;
    }
    const boundaryIndex = tailBoundaryIndex(kept, tail);
    const slice = kept.slice(boundaryIndex);
    const reachedStart = regionStart === 0 && boundaryIndex === 0;
    const cursor = reachedStart
      ? null
      : boundaryIndex > 0
        ? kept[boundaryIndex].offset
        : regionStart + carry.length;
    return { events: slice.map((line) => line.event), cursor };
  } finally {
    closeSync(fd);
  }
}

export async function loadSession(
  cwd: string,
  sessionId: string,
  options: LoadSessionOptions = {},
): Promise<LoadSessionResult> {
  const filepath = findSessionFile(cwd, sessionId);
  if (!filepath) return { events: [], cursor: null, meta: null };
  const { size } = statSync(filepath);
  const tail = options.tail && options.tail > 0 ? Math.floor(options.tail) : undefined;
  const paging = options.before !== undefined;

  if (!tail && !paging) {
    if (size <= FULL_READ_BYTE_CAP) {
      const events: SessionEvent[] = [];
      const stream = createReadStream(filepath, { encoding: "utf-8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        const event = parseEvent(line);
        if (event) events.push(event);
      }
      return { events: activeBranchEvents(filepath, events), cursor: null, meta: null };
    }
    return loadSession(cwd, sessionId, { tail: 2000 });
  }

  const effectiveTail = tail ?? 500;
  const transcript = await transcriptSource(filepath);
  const { events, cursor } = readTailRegion(
    transcript.filepath,
    transcript.size,
    effectiveTail,
    options.before,
  );

  if (!paging) {
    const [{ headerEvents, meta }, usage] = await Promise.all([
      readSessionHead(filepath),
      readSessionUsageTotals(filepath),
    ]);
    meta.usage = usage;
    const hasHeader = events.some((event) => event.type === "session");
    return {
      events: activeBranchEvents(filepath, hasHeader ? events : [...headerEvents, ...events]),
      cursor,
      meta,
    };
  }
  return { events: activeBranchEvents(filepath, events), cursor, meta: null };
}
