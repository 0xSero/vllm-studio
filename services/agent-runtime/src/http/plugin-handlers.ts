import { Schema } from "effect";
import { listBuiltinPlugins } from "../builtin-plugins";
import { PluginUpsertInputSchema } from "../plugin-contract";
import { errorMessage } from "./helpers";
import {
  listUserPlugins,
  readUserPlugin,
  removeUserPlugin,
  resolveUserPluginsDir,
  setUserPluginEnabled,
  writeUserPlugin,
} from "../user-plugins";

const failure = (message: string, status: number) => Response.json({ error: message }, { status });

async function listing(): Promise<Response> {
  const [builtin, user] = await Promise.all([listBuiltinPlugins(), listUserPlugins()]);
  return Response.json({
    directory: resolveUserPluginsDir(),
    plugins: [...builtin, ...user],
  });
}

export async function handlePluginsList(): Promise<Response> {
  return listing();
}

export async function handlePluginUpsert(request: Request): Promise<Response> {
  let body: typeof PluginUpsertInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(PluginUpsertInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "invalid plugin payload" }, { status: 400 });
  }
  try {
    if (body.source !== undefined) await writeUserPlugin(body.id, body.source);
    if (body.enabled !== undefined) await setUserPluginEnabled(body.id, body.enabled);
    return listing();
  } catch (error) {
    return failure(errorMessage(error, "Plugin could not be saved"), 409);
  }
}

export async function handlePluginDelete(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    await removeUserPlugin(id);
    return listing();
  } catch (error) {
    return failure(errorMessage(error, "Plugin could not be removed"), 409);
  }
}

export async function handlePluginSource(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    return Response.json(await readUserPlugin(id));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Plugin could not be read" },
      { status: 404 },
    );
  }
}
