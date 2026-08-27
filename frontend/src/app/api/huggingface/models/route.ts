import { NextRequest, NextResponse } from "next/server";
import { Option, Schema } from "effect";
import { fetchWithTimeout } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HF_MODELS = "https://huggingface.co/api/models";
const TIMEOUT_MS = 12_000;

const HuggingFacePayloadSchema = Schema.Json;
type HuggingFacePayload = typeof HuggingFacePayloadSchema.Type;
const HuggingFaceModelSchema = Schema.Record(Schema.String, Schema.Json);
type HuggingFaceModel = typeof HuggingFaceModelSchema.Type;
const decodeHuggingFacePayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(HuggingFacePayloadSchema),
);
const decodeHuggingFaceModel = Schema.decodeUnknownOption(HuggingFaceModelSchema);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeNumber = Schema.decodeUnknownOption(
  Schema.Union([Schema.Number, Schema.NumberFromString]),
);
const decodeTags = Schema.decodeUnknownOption(Schema.Array(Schema.Json));

// HF /api/models supports these query params. `filter` and `tags` are
// repeatable (AND logic); the route forwards all of them. `pipeline_tag` and
// `config` are forwarded so callers can filter by task / fetch architecture
// metadata. `full=true` returns `siblings` (file list with sizes) used for
// accurate VRAM sizing. (`direction` is intentionally omitted — HF rejects it.)
const ALLOWED_PARAMS = new Set([
  "author",
  "config",
  "filter",
  "full",
  "library",
  "limit",
  "offset",
  "pipeline_tag",
  "search",
  "sort",
  "tags",
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
      { headers: { accept: "application/json" } },
      TIMEOUT_MS,
    );
    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        { error: `Hugging Face returned ${response.status}.`, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }
    const payload = decodeHuggingFacePayload(text);
    const data = Array.isArray(payload) ? payload.map(normalizeModel) : payload;
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Hugging Face models.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function normalizeModel(model: HuggingFacePayload) {
  const decoded = decodeHuggingFaceModel(model);
  const record: HuggingFaceModel = Option.isSome(decoded) ? decoded.value : {};
  const modelIdValue = decodeString(record.modelId ?? record.id);
  const modelId = Option.isSome(modelIdValue) ? modelIdValue.value : "";
  // Compute total weight-file size from siblings when present (full=true).
  // Used for accurate VRAM sizing instead of the name-regex estimate.
  const siblings = decodeTags(record.siblings);
  const weightBytes = (Option.isSome(siblings) ? siblings.value : []).reduce<number>(
    (sum, file) => {
      const decodedFile = decodeHuggingFaceModel(file);
      if (Option.isNone(decodedFile)) return sum;
      const rfilename = decodeString(decodedFile.value.rfilename);
      if (
        Option.isSome(rfilename) &&
        /\.(safetensors|bin|pt|gguf|ggml|ot|model|npz|msgpack)(\.index\.json)?$/.test(
          rfilename.value,
        )
      ) {
        const size = decodeNumber(decodedFile.value.size);
        return sum + (Option.isSome(size) ? size.value : 0);
      }
      return sum;
    },
    0,
  );
  const id = decodeString(record._id);
  const downloads = decodeNumber(record.downloads);
  const likes = decodeNumber(record.likes);
  const tags = decodeTags(record.tags);
  return {
    ...record,
    _id: Option.isSome(id) ? id.value : modelId,
    modelId,
    downloads: Option.isSome(downloads) ? downloads.value : 0,
    likes: Option.isSome(likes) ? likes.value : 0,
    tags: Option.isSome(tags) ? tags.value : [],
    private: Boolean(record.private),
    weightBytes: weightBytes || undefined,
  };
}
