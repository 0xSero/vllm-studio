import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HF_MODELS = "https://huggingface.co/api/models";
const TIMEOUT_MS = 12_000;
const ALLOWED_PARAMS = new Set([
  "author",
  "filter",
  "full",
  "library",
  "limit",
  "offset",
  "search",
  "sort",
]);

export async function GET(request: NextRequest) {
  const source = new URL(request.url);
  const target = new URL(HF_MODELS);
  for (const [key, value] of source.searchParams) {
    if (ALLOWED_PARAMS.has(key) && value.trim()) target.searchParams.append(key, value);
  }
  if (!target.searchParams.has("limit")) target.searchParams.set("limit", "50");
  if (!target.searchParams.has("full")) target.searchParams.set("full", "false");

  try {
    const response = await fetchWithTimeout(
      target.toString(),
      {
        headers: { accept: "application/json" },
      },
      TIMEOUT_MS,
    );
    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        { error: `Hugging Face returned ${response.status}.`, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }
    const payload = JSON.parse(text) as unknown;
    const data = Array.isArray(payload) ? payload.map(normalizeModel) : payload;
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Hugging Face models.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function normalizeModel(model: unknown): Record<string, unknown> {
  const record = model && typeof model === "object" ? (model as Record<string, unknown>) : {};
  const modelId = String(record.modelId ?? record.id ?? "");
  return {
    ...record,
    _id: String(record._id ?? modelId),
    modelId,
    downloads: Number(record.downloads ?? 0),
    likes: Number(record.likes ?? 0),
    tags: Array.isArray(record.tags) ? record.tags : [],
    private: Boolean(record.private),
  };
}
