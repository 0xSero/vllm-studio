export type ByteRange = { start: number; end: number };

function suffixRange(text: string, size: number): ByteRange | null {
  const suffix = Number(text);
  if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
  return { start: Math.max(0, size - suffix), end: size - 1 };
}

function explicitRange(startText: string, endText: string, size: number): ByteRange | null {
  const start = Number(startText);
  const end = endText ? Number(endText) : size - 1;
  const invalid =
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start;
  return invalid ? null : { start, end: Math.min(end, size - 1) };
}

export function parseByteRange(value: string | null, size: number): ByteRange | undefined | null {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) return null;
  return startText ? explicitRange(startText, endText, size) : suffixRange(endText, size);
}
