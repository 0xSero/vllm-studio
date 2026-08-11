export const jsonError = (message: string, status = 400): Response =>
  Response.json({ error: message }, { status });

export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
