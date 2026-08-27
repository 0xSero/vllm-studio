import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { errorMessage, jsonError, requireAbsoluteCwd } from "@/app/api/_lib/route-helpers";
import { openReadableFile } from "@/features/agent/fs-store";
import { requireApiAccess } from "@/lib/auth/guard";
import { parseByteRange } from "./byte-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INLINE_TYPES = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".mpeg", "video/mpeg"],
  [".mpg", "video/mpeg"],
  [".ogv", "video/ogg"],
  [".webm", "video/webm"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".oga", "audio/ogg"],
  [".ogg", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".wav", "audio/wav"],
  [".wave", "audio/wav"],
]);

function responseBody(file: FileHandle, start: number, end: number, size: number) {
  if (size === 0) return null;
  const stream = file.createReadStream({ start, end });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(new Uint8Array(Buffer.from(chunk))));
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });
}

async function serveFile(request: NextRequest, cwd: string, relPath: string): Promise<Response> {
  let file: FileHandle | undefined;
  try {
    const opened = await openReadableFile(cwd, relPath);
    file = opened.file;
    const range = parseByteRange(request.headers.get("range"), opened.size);
    if (range === null) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${opened.size}`, "accept-ranges": "bytes" },
      });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, opened.size - 1);
    const body = responseBody(file, start, end, opened.size);
    if (body) file = undefined;
    const inlineType = INLINE_TYPES.get(path.extname(relPath).toLowerCase());
    const headers = new Headers({
      "content-type": inlineType ?? "application/octet-stream",
      "content-length": String(opened.size === 0 ? 0 : end - start + 1),
      "content-disposition": inlineType
        ? `inline; filename="${encodeURIComponent(path.basename(relPath))}"`
        : `attachment; filename="${encodeURIComponent(path.basename(relPath))}"`,
      "last-modified": opened.modifiedAt.toUTCString(),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "accept-ranges": "bytes",
      "cross-origin-resource-policy": "same-origin",
    });
    if (range) headers.set("content-range", `bytes ${start}-${end}/${opened.size}`);
    return new Response(body, { status: range ? 206 : 200, headers });
  } finally {
    await file?.close().catch(() => undefined);
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const result = requireAbsoluteCwd(request);
  if (result.response) return result.response;
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!relPath) return jsonError("path is required");
  try {
    return await serveFile(request, result.cwd, relPath);
  } catch (error) {
    return jsonError(errorMessage(error, "Read failed"), 404);
  }
}
