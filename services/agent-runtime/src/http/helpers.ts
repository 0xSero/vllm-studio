import { Option, Schema } from "effect";
import type { UnparsedValue, UnknownRecord } from "../../../../shared/agent/guards";

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function readJsonBody(
  request: Request,
  options?: { maxChars?: number },
): Promise<UnknownRecord | null> {
  try {
    const text = await request.text();
    if (options?.maxChars !== undefined && text.length > options.maxChars) return null;
    return Option.getOrNull(Schema.decodeUnknownOption(UnknownRecordSchema)(JSON.parse(text)));
  } catch {
    return null;
  }
}

export function errorMessage(error: UnparsedValue, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
