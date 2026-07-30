import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type SearchRow = {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  description?: unknown;
  position?: unknown;
  score?: unknown;
};

type SearchResponse = {
  success?: unknown;
  data?: unknown;
};

const frontendBase = (
  process.env.LOCAL_STUDIO_FRONTEND_BASE?.trim() || "http://127.0.0.1:3000"
).replace(/\/+$/, "");
const timeoutMs = 20_000;

const output = (text: string, details: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text }],
  details,
});

const rowsFrom = (payload: SearchResponse): SearchRow[] => {
  if (!Array.isArray(payload.data)) return [];
  return payload.data.filter(
    (row): row is SearchRow => Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
};

export default function registerFastCrwSearch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "crw_search",
    label: "FastCRW: Search",
    description:
      "Search the web through the configured FastCRW service and return source titles, URLs, snippets, positions, and scores.",
    promptSnippet: "Search the web with FastCRW when current external sources are required",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 2000 }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
      lang: Type.Optional(Type.String({ minLength: 2, maxLength: 16 })),
      recency: Type.Optional(
        Type.Union([
          Type.Literal("qdr:h"),
          Type.Literal("qdr:d"),
          Type.Literal("qdr:w"),
          Type.Literal("qdr:m"),
          Type.Literal("qdr:y"),
        ]),
      ),
      categories: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 5 }),
      ),
    }),
    async execute(_id, params, signal) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      try {
        const response = await fetch(`${frontendBase}/api/agent/onboarding/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: params.query,
            limit: params.limit ?? 5,
            ...(params.lang ? { lang: params.lang } : {}),
            ...(params.recency ? { recency: params.recency } : {}),
            ...(params.categories?.length ? { categories: params.categories } : {}),
          }),
          signal: controller.signal,
        });
        const payload = (await response.json()) as SearchResponse;
        if (!response.ok || payload.success !== true) {
          return output(`crw_search failed: HTTP ${response.status}`, {
            failed: true,
            status: response.status,
          });
        }
        const rows = rowsFrom(payload).map((row, index) => ({
          title: typeof row.title === "string" ? row.title : "Untitled result",
          url: typeof row.url === "string" ? row.url : "",
          snippet:
            typeof row.snippet === "string"
              ? row.snippet
              : typeof row.description === "string"
                ? row.description
                : "",
          position: typeof row.position === "number" ? row.position : index + 1,
          score: typeof row.score === "number" ? row.score : null,
        }));
        return output(JSON.stringify(rows, null, 2), {
          provider: "fastcrw",
          endpoint: "keyring-proxy",
          count: rows.length,
          results: rows,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return output(`crw_search failed: ${message}`, { failed: true, error: message });
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    },
  });
}
