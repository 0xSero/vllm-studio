// Session-title normalization shared by the agent runtime package (session
// summaries read from disk) and the frontend's client-side message helpers.

export function isPlaceholderSessionTitle(value: string | null | undefined): boolean {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return Boolean(normalized && /^(?:\.{3}|…)+$/.test(normalized));
}

export function cleanSessionTitle(value: string | null | undefined): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized && !isPlaceholderSessionTitle(normalized) ? normalized : "";
}
