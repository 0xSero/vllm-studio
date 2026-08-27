import { NextRequest, NextResponse } from "next/server";
import { Option, Schema } from "effect";
import { fetchWithTimeout } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HF_API = "https://huggingface.co/api/models";
const HF_RAW = "https://huggingface.co";
const TIMEOUT_MS = 10_000;
const MAX_README_CHARS = 12_000;

type HuggingFaceModelCardPayload = {
  modelId: string;
  author?: string;
  sha?: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  pipeline_tag?: string;
  library_name?: string;
  createdAt?: string;
  lastModified?: string;
  cardData?: object;
  siblings?: Array<{ rfilename?: string; size?: number }>;
  readme?: string;
  url: string;
};

const HuggingFaceRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const HuggingFaceSiblingSchema = Schema.Struct({
  rfilename: Schema.optional(Schema.Unknown),
  size: Schema.optional(Schema.Unknown),
});
const decodeRecord = Schema.decodeUnknownOption(HuggingFaceRecordSchema);
const EMPTY_HUGGING_FACE_RECORD = Schema.decodeUnknownSync(HuggingFaceRecordSchema)({});
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeNumber = Schema.decodeUnknownOption(Schema.Number);
const decodeStringArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const decodeSiblingArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const decodeSibling = Schema.decodeUnknownOption(HuggingFaceSiblingSchema);
const isString = Schema.is(Schema.String);

type HuggingFaceMetadata = Omit<HuggingFaceModelCardPayload, "modelId" | "readme" | "url">;

export async function GET(request: NextRequest) {
  const modelId = request.nextUrl.searchParams.get("modelId")?.trim() ?? "";
  if (!isValidModelId(modelId)) {
    return NextResponse.json({ error: "Invalid model id." }, { status: 400 });
  }

  try {
    const [metadata, readme] = await Promise.all([
      fetchMetadata(modelApiUrl(modelId)),
      fetchReadme(modelId),
    ]);
    const payload: HuggingFaceModelCardPayload = {
      modelId,
      ...metadata,
      readme,
      url: `https://huggingface.co/${modelId}`,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load model card.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function isValidModelId(modelId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(modelId);
}

function modelApiUrl(modelId: string): string {
  return `${HF_API}/${modelId.split("/").map(encodeURIComponent).join("/")}?full=true&blobs=true`;
}

function readmeUrl(modelId: string): string {
  return `${HF_RAW}/${modelId.split("/").map(encodeURIComponent).join("/")}/raw/main/README.md`;
}

function nonBlankString(value: Option.Option<string>): string | undefined {
  const decoded = Option.getOrUndefined(value);
  return decoded?.trim() ? decoded : undefined;
}

async function fetchMetadata(url: string): Promise<HuggingFaceMetadata> {
  const response = await fetchWithTimeout(
    url,
    { headers: { accept: "application/json" } },
    TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`Hugging Face returned ${response.status}.`);

  const record = Option.getOrElse(
    decodeRecord(await response.json()),
    () => EMPTY_HUGGING_FACE_RECORD,
  );
  const tags = Option.getOrUndefined(decodeStringArray(record["tags"]))?.filter(isString);
  const siblingValues = Option.getOrUndefined(decodeSiblingArray(record["siblings"]));
  const siblings = siblingValues?.flatMap((value) => {
    const sibling = Option.getOrUndefined(decodeSibling(value));
    if (!sibling) return [];
    return [
      {
        rfilename: nonBlankString(decodeString(sibling.rfilename)),
        size: Option.getOrUndefined(decodeNumber(sibling.size)),
      },
    ];
  });

  return {
    author: nonBlankString(decodeString(record["author"])),
    sha: nonBlankString(decodeString(record["sha"])),
    downloads: Option.getOrUndefined(decodeNumber(record["downloads"])),
    likes: Option.getOrUndefined(decodeNumber(record["likes"])),
    tags: tags?.length ? tags : undefined,
    pipeline_tag: nonBlankString(decodeString(record["pipeline_tag"])),
    library_name: nonBlankString(decodeString(record["library_name"])),
    createdAt: nonBlankString(decodeString(record["createdAt"])),
    lastModified: nonBlankString(decodeString(record["lastModified"])),
    cardData: Option.getOrUndefined(
      Schema.decodeUnknownOption(HuggingFaceRecordSchema)(record["cardData"]),
    ),
    siblings,
  };
}

async function fetchReadme(modelId: string): Promise<string | undefined> {
  const response = await fetchWithTimeout(
    readmeUrl(modelId),
    {
      headers: { accept: "text/plain" },
    },
    TIMEOUT_MS,
  );
  if (!response.ok) return undefined;
  const text = await response.text();
  return text.slice(0, MAX_README_CHARS);
}
