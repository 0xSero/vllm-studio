import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import { PluginUpsertInputSchema } from "@local-studio/agent-runtime/plugin-contract";
import {
  listUserPlugins,
  removeUserPlugin,
  resolveUserPluginsDir,
  setUserPluginEnabled,
  writeUserPlugin,
} from "@local-studio/agent-runtime/user-plugins";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failure = (error: unknown, fallback: string, status: number) =>
  NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });

async function listing() {
  return NextResponse.json({
    directory: resolveUserPluginsDir(),
    plugins: await listUserPlugins(),
  });
}

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return listing();
}

/**
 * Write a plugin's source, flip it on or off, or both.
 *
 * Writing is not running: the file lands in the extensions directory and is
 * picked up the next time a session is built, which is also the next time the
 * user sends a message. Nothing is spawned here.
 */
export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof PluginUpsertInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(PluginUpsertInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid plugin payload" }, { status: 400 });
  }
  try {
    if (body.source !== undefined) await writeUserPlugin(body.id, body.source);
    if (body.enabled !== undefined) await setUserPluginEnabled(body.id, body.enabled);
    return listing();
  } catch (error) {
    return failure(error, "Plugin could not be saved", 409);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    await removeUserPlugin(id);
    return listing();
  } catch (error) {
    return failure(error, "Plugin could not be removed", 409);
  }
}
