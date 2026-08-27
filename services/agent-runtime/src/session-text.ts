import { openSync, readSync, closeSync, statSync } from "node:fs";
import { findSessionFile } from "./sessions-store";
import { isRecord, type UnparsedValue } from "../../../shared/agent/guards";
import { Schema } from "effect";

const isString = Schema.is(Schema.String);

const TAIL_BYTES = 256 * 1024;

function readTail(filepath: string): string {
  const { size } = statSync(filepath);
  const start = Math.max(0, size - TAIL_BYTES);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = openSync(filepath, "r");
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

export function assistantMessageText(content: UnparsedValue): string {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      isRecord(block) && block.type === "text" && isString(block.text) ? block.text : "",
    )
    .join("");
}

export type LastAssistantResult = {
  text: string;
  error: string | null;
};

export function lastAssistantResultFromJsonl(raw: string): LastAssistantResult {
  let text = "";
  let error: string | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: UnparsedValue;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
    if (entry.message.role !== "assistant") continue;
    const messageText = assistantMessageText(entry.message.content).trim();
    if (messageText) {
      text = messageText;
      error = null;
      continue;
    }
    if (isString(entry.message.errorMessage) && entry.message.errorMessage.trim()) {
      error = entry.message.errorMessage.trim();
    }
  }
  return { text, error };
}

export function lastAssistantResult(cwd: string, piSessionId: string): LastAssistantResult {
  const filepath = findSessionFile(cwd, piSessionId);
  if (!filepath) return { text: "", error: null };
  try {
    return lastAssistantResultFromJsonl(readTail(filepath));
  } catch {
    return { text: "", error: null };
  }
}
