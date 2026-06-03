import { NextRequest, NextResponse } from "next/server";
import {
  MCP_CATALOGUE,
  discoverMcpServers,
  findCatalogueEntry,
  isBuiltinServerId,
  removeServer,
  setServerEnabled,
  upsertServer,
  type McpServerDef,
} from "@/lib/agent/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The composer catalogue + MCP settings panel both read this. `plugins` keeps
// the legacy key (consumers map it to ComposerPluginRef); `catalogue` is the
// curated trusted list a user can one-click add.
function snapshot(includeDisabled: boolean) {
  const all = discoverMcpServers();
  const plugins = includeDisabled ? all : all.filter((row) => row.enabled);
  return { plugins, catalogue: MCP_CATALOGUE };
}

export async function GET(request: NextRequest) {
  const includeDisabled = request.nextUrl.searchParams.get("includeDisabled") === "1";
  return NextResponse.json(snapshot(includeDisabled));
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseArgs(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const args = value.filter((item): item is string => typeof item === "string");
  return args.length ? args : undefined;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return badRequest("Expected { action }.");
  }

  switch (body.action) {
    case "set_enabled": {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id || typeof body.enabled !== "boolean") {
        return badRequest("set_enabled requires { id, enabled }.");
      }
      setServerEnabled(id, body.enabled, isBuiltinServerId(id));
      return NextResponse.json(snapshot(true));
    }

    case "remove": {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return badRequest("remove requires { id }.");
      if (isBuiltinServerId(id))
        return badRequest("Builtin servers can't be removed, only disabled.");
      removeServer(id);
      return NextResponse.json(snapshot(true));
    }

    case "add_from_catalogue": {
      const catalogueId = typeof body.catalogueId === "string" ? body.catalogueId : "";
      const entry = findCatalogueEntry(catalogueId);
      if (!entry) return badRequest("Unknown catalogue entry.");
      const env = { ...(entry.env ?? {}), ...(parseEnv(body.env) ?? {}) };
      const missing = (entry.requiredEnv ?? []).filter((key) => !env[key]?.trim());
      if (missing.length) {
        return badRequest(`Missing required values: ${missing.join(", ")}.`);
      }
      const extraArgs = parseArgs(body.args);
      const def: McpServerDef = {
        id: `mcp:${entry.name}:${Date.now().toString(36)}`,
        name: entry.name,
        displayName: entry.displayName,
        description: entry.description,
        ...(entry.shortDescription ? { shortDescription: entry.shortDescription } : {}),
        category: entry.category,
        transport: "stdio",
        command: entry.command,
        args: extraArgs ?? entry.args,
        ...(Object.keys(env).length ? { env } : {}),
      };
      upsertServer(def, "marketplace");
      return NextResponse.json(snapshot(true));
    }

    case "add_manual": {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const command = typeof body.command === "string" ? body.command.trim() : "";
      if (!name || !command) return badRequest("add_manual requires { name, command }.");
      const slug = slugify(name) || "server";
      const def: McpServerDef = {
        id:
          typeof body.id === "string" && body.id.trim()
            ? body.id.trim()
            : `mcp:${slug}:${Date.now().toString(36)}`,
        name: slug,
        displayName: name,
        ...(typeof body.description === "string" && body.description.trim()
          ? { description: body.description.trim() }
          : {}),
        category: "Custom",
        transport: "stdio",
        command,
        ...(parseArgs(body.args) ? { args: parseArgs(body.args) } : {}),
        ...(parseEnv(body.env) ? { env: parseEnv(body.env) } : {}),
        ...(typeof body.cwd === "string" && body.cwd.trim() ? { cwd: body.cwd.trim() } : {}),
      };
      upsertServer(def, "manual");
      return NextResponse.json(snapshot(true));
    }

    default:
      return badRequest(`Unknown action: ${String(body.action)}.`);
  }
}
