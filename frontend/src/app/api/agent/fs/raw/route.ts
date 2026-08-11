import { NextRequest } from "next/server";
import path from "node:path";
import { readFileBytes } from "@local-studio/agent-runtime/workspace-files";
import { requireApiAccess } from "@/lib/auth/guard";
import { errorMessage, jsonError, requireAbsoluteCwd } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only formats the Files panel renders inline get their real media type. Every
// other file is served as an opaque download, so a repo's own .html/.svg can
// never execute as a same-origin document.
const INLINE_TYPES: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const result = requireAbsoluteCwd(request);
  if (result.response) return result.response;
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!relPath) return jsonError("path is required");
  try {
    const { bytes, size, modifiedAt } = await readFileBytes(result.cwd, relPath);
    const name = path.basename(relPath);
    const inlineType = INLINE_TYPES[path.extname(relPath).toLowerCase()];
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": inlineType ?? "application/octet-stream",
        "content-length": String(size),
        "content-disposition": inlineType
          ? `inline; filename="${encodeURIComponent(name)}"`
          : `attachment; filename="${encodeURIComponent(name)}"`,
        "last-modified": modifiedAt.toUTCString(),
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Read failed"), 404);
  }
}
