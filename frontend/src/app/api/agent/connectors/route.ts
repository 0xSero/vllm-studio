import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import { ConnectorUpsertInputSchema } from "@local-studio/agent-runtime/connector-contract";
import {
  connectorToolPrefix,
  isValidConnectorId,
  listConnectors,
  removeConnector,
  toConnectorView,
  upsertConnector,
  type ConnectorConfig,
} from "@local-studio/agent-runtime/connectors-service";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const connectors = await listConnectors();
  return NextResponse.json({ connectors: connectors.map(toConnectorView) });
}

/**
 * Everything a submitted connector can be refused for, in one place.
 *
 * A connector row names a command to execute or an endpoint to trust, so the
 * server checks it rather than relying on the form that happened to submit it —
 * this route is reachable by anything that can reach loopback, including the
 * agent's own tools.
 */
async function rejectionFor(
  body: typeof ConnectorUpsertInputSchema.Type,
): Promise<NextResponse | null> {
  const reject = (error: string, status: number) => NextResponse.json({ error }, { status });
  if (!isValidConnectorId(body.id)) return reject("invalid connector id", 400);
  if (body.transport === "stdio" && !body.command) {
    return reject("command is required for stdio", 400);
  }
  if (body.transport === "http") {
    if (!body.url) return reject("url is required for http", 400);
    // An MCP endpoint is fetched by this process with whatever headers the row
    // carries, so the scheme is worth pinning: `file:` would read local paths
    // and the exotic schemes are not something a user meant to type.
    if (!/^https?:\/\//i.test(body.url)) {
      return reject("url must start with http:// or https://", 400);
    }
  }
  // Tool names are namespaced `<id with - as _>_<tool>`, so `a-b` and `a_b`
  // would offer the model two different servers under one name and the second
  // registration would quietly win. Ids are compared on that derived prefix
  // rather than literally, and only against *other* rows so a row can always be
  // saved over itself.
  const collision = (await listConnectors()).find(
    (entry) =>
      entry.id !== body.id && connectorToolPrefix(entry.id) === connectorToolPrefix(body.id),
  );
  return collision
    ? reject(`Tool names would collide with connector "${collision.id}"`, 409)
    : null;
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof ConnectorUpsertInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorUpsertInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid connector payload" }, { status: 400 });
  }
  const rejection = await rejectionFor(body);
  if (rejection) return rejection;
  const connector: ConnectorConfig = {
    id: body.id,
    name: body.name?.trim() || body.id,
    transport: body.transport,
    ...(body.command ? { command: body.command } : {}),
    ...(body.args ? { args: body.args } : {}),
    ...(body.env ? { env: body.env } : {}),
    ...(body.envSecret ? { envSecret: body.envSecret } : {}),
    ...(body.cwd ? { cwd: body.cwd } : {}),
    ...(body.url ? { url: body.url } : {}),
    ...(body.headers ? { headers: body.headers } : {}),
    ...(body.headerSecret ? { headerSecret: body.headerSecret } : {}),
    // Three states, not two. Absent means "leave the allow list alone" — what
    // every caller that only meant to flip `enabled` sends. An empty list means
    // "clear it, allow every tool this server declares", which is the widening
    // an authoring UI has to be able to express and could not before. A
    // populated list is the restriction itself.
    ...(body.allowTools === undefined
      ? {}
      : { allowTools: body.allowTools.length > 0 ? body.allowTools : undefined }),
    enabled: body.enabled ?? true,
  };
  try {
    const connectors = await upsertConnector(connector);
    closePooledConnection(connector.id);
    return NextResponse.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connector could not be saved" },
      { status: 409 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const connectors = await removeConnector(id);
    closePooledConnection(id);
    return NextResponse.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connector could not be removed" },
      { status: 409 },
    );
  }
}
