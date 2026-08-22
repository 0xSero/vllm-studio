//
// HTTP surface for user plugins: the listing, source reads, writes, enable
// flips, and removal. Moved verbatim from the Next route handlers so plugins
// authored in the UI land in the runtime's extensions directory — the one the
// agent actually loads from.
//

import { PluginUpsertInputSchema } from "../plugin-contract";
import {
  listUserPlugins,
  readUserPlugin,
  removeUserPlugin,
  resolveUserPluginsDir,
  setUserPluginEnabled,
  writeUserPlugin,
} from "../user-plugins";
import { discoverSkills, loadSkillInstructions } from "../skill-discovery";
import { discoverPromptTemplates, loadPromptTemplateInstructions } from "../prompt-templates-store";
import { decodeBody, errorMessage, jsonError } from "./helpers";

/** The listing every write answers with, so the tab never re-fetches. */
export async function handlePluginsList(): Promise<Response> {
  return Response.json({
    directory: resolveUserPluginsDir(),
    plugins: await listUserPlugins(),
  });
}

/**
 * Write a plugin's source, flip it on or off, or both.
 *
 * Writing is not running: the file lands in the extensions directory and is
 * picked up the next time a session is built, which is also the next time the
 * user sends a message. Nothing is spawned here.
 */
export async function handlePluginUpsert(request: Request): Promise<Response> {
  const body = await decodeBody(request, PluginUpsertInputSchema, "invalid plugin payload");
  if (body instanceof Response) return body;
  try {
    if (body.source !== undefined) await writeUserPlugin(body.id, body.source);
    if (body.enabled !== undefined) await setUserPluginEnabled(body.id, body.enabled);
    return handlePluginsList();
  } catch (error) {
    return jsonError(errorMessage(error, "Plugin could not be saved"), 409);
  }
}

export async function handlePluginDelete(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return jsonError("id is required");
  try {
    await removeUserPlugin(id);
    return handlePluginsList();
  } catch (error) {
    return jsonError(errorMessage(error, "Plugin could not be removed"), 409);
  }
}

/**
 * One plugin's source. Split from the listing route because a list of plugins
 * is read on every visit to the tab while the code behind them is read only
 * when one is opened, and shipping every file's text to draw a table of names
 * would make the tab slower the more plugins a user writes.
 */
export async function handlePluginSource(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return jsonError("id is required");
  try {
    return Response.json(await readUserPlugin(id));
  } catch (error) {
    return jsonError(errorMessage(error, "Plugin could not be read"), 404);
  }
}

// ─── Skills and prompt templates ──────────────────────────────────────────
//
// Both walk directories on the machine the agent runs on, so a remote runtime
// must be the one answering.

export const handleSkillsList = (): Response => Response.json({ skills: discoverSkills() });

export function handleSkillLoad(request: Request): Response {
  const skillPath = new URL(request.url).searchParams.get("path") ?? "";
  const skill = skillPath ? loadSkillInstructions(skillPath) : null;
  return skill ? Response.json({ skill }) : jsonError("Skill not found", 404);
}

export const handlePromptTemplatesList = (): Response =>
  Response.json({ templates: discoverPromptTemplates() });

export function handlePromptTemplateLoad(request: Request): Response {
  const templatePath = new URL(request.url).searchParams.get("path") ?? "";
  const template = templatePath ? loadPromptTemplateInstructions(templatePath) : null;
  return template ? Response.json({ template }) : jsonError("Template not found", 404);
}
