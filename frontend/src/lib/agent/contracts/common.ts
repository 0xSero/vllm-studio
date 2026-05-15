export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringField(
  record: Record<string, unknown>,
  key: string,
  required = false,
): ParseResult<string | undefined> {
  const value = record[key];
  if (value == null) {
    return required ? { ok: false, error: `${key} is required` } : { ok: true, value: undefined };
  }
  if (typeof value !== "string") return { ok: false, error: `${key} must be a string` };
  const trimmed = value.trim();
  if (required && !trimmed) return { ok: false, error: `${key} is required` };
  return { ok: true, value: trimmed || undefined };
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function boolField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}
