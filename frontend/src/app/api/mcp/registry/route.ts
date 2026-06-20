import { NextRequest, NextResponse } from "next/server";
import { searchOfficialCompatibleRegistry } from "@/features/agent/mcp/official-registry";
import { handleRegistryAction, listRegistrySources } from "@/features/agent/mcp/registry-sources";

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
  const result = handleRegistryAction(body);
  return NextResponse.json(result.payload, { status: result.status });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
