export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
