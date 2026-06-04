import { NextRequest, NextResponse } from "next/server";
import { searchOfficialCompatibleRegistry } from "@/lib/agent/mcp/official-registry";
import {
  addRegistrySource,
  listRegistrySources,
  removeRegistrySource,
  setRegistrySourceEnabled,
} from "@/lib/agent/mcp/registry-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 24);
  const registries = listRegistrySources();
  const enabled = registries.filter((source) => source.enabled);

  const results = await Promise.allSettled(
    enabled.map((source) => searchOfficialCompatibleRegistry({ source, query, limit })),
  );
  const entries = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value.entries : [],
  );
  const warnings = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${enabled[index]?.name ?? "Registry"}: ${errorMessage(result.reason)}`]
      : [],
  );

  if (!entries.length && warnings.length === enabled.length && enabled.length) {
    return NextResponse.json(
      {
        source: "official",
        sourceUrl: enabled[0]?.url ?? "https://registry.modelcontextprotocol.io",
        registries,
        entries: [],
        warnings,
        error: warnings.join("; "),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    source: "official",
    sourceUrl: enabled[0]?.url ?? "https://registry.modelcontextprotocol.io",
    registries,
    entries: entries.slice(0, Math.min(Math.max(limit, 1), 100)),
    ...(warnings.length ? { warnings } : {}),
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Expected { action }." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "add_registry": {
        const name = typeof body.name === "string" ? body.name : "";
        const url = typeof body.url === "string" ? body.url : "";
        if (!url.trim()) {
          return NextResponse.json({ error: "Registry URL is required." }, { status: 400 });
        }
        addRegistrySource({ name, url });
        return NextResponse.json({ registries: listRegistrySources(), entries: [] });
      }
      case "set_registry_enabled": {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id || typeof body.enabled !== "boolean") {
          return NextResponse.json(
            { error: "set_registry_enabled requires { id, enabled }." },
            { status: 400 },
          );
        }
        setRegistrySourceEnabled(id, body.enabled);
        return NextResponse.json({ registries: listRegistrySources(), entries: [] });
      }
      case "remove_registry": {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) {
          return NextResponse.json({ error: "remove_registry requires { id }." }, { status: 400 });
        }
        removeRegistrySource(id);
        return NextResponse.json({ registries: listRegistrySources(), entries: [] });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
