import { Schema } from "effect";
import { OAuthClientInputSchema, OAuthConnectorInputSchema } from "../oauth-connector-contract";
import {
  beginOAuthConnectorAuthorization,
  cancelOAuthConnectorAuthorization,
  disconnectOAuthConnector,
  getOAuthConnectorStatus,
  OAuthConnectorError,
  saveOAuthConnectorClient,
} from "../oauth-connectors";
import { closePooledConnection } from "../connector-pool";

function failure(error: Error | null, fallback: string): Response {
  const status = error instanceof OAuthConnectorError ? error.status : 500;
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

async function connectorIdFromBody(request: Request): Promise<string | null> {
  try {
    const input = Schema.decodeUnknownSync(OAuthConnectorInputSchema)(await request.json());
    return input.connectorId.trim() || null;
  } catch {
    return null;
  }
}

export async function handleOAuthAuthorizeBegin(request: Request): Promise<Response> {
  const connectorId = await connectorIdFromBody(request);
  if (!connectorId) return Response.json({ error: "connectorId is required" }, { status: 400 });
  try {
    return Response.json(await beginOAuthConnectorAuthorization(connectorId));
  } catch (error) {
    return failure(error instanceof Error ? error : null, "OAuth sign-in failed");
  }
}

export async function handleOAuthAuthorizeCancel(request: Request): Promise<Response> {
  const connectorId = await connectorIdFromBody(request);
  if (!connectorId) return Response.json({ error: "connectorId is required" }, { status: 400 });
  try {
    cancelOAuthConnectorAuthorization(connectorId);
    return Response.json({ cancelled: true });
  } catch (error) {
    return failure(error instanceof Error ? error : null, "OAuth cancellation failed");
  }
}

export async function handleOAuthStatus(request: Request): Promise<Response> {
  const connectorId = new URL(request.url).searchParams.get("connectorId")?.trim();
  if (!connectorId) return Response.json({ error: "connectorId is required" }, { status: 400 });
  try {
    return Response.json(await getOAuthConnectorStatus(connectorId));
  } catch (error) {
    return failure(error instanceof Error ? error : null, "OAuth status failed");
  }
}

export async function handleOAuthClientPut(request: Request): Promise<Response> {
  let input: typeof OAuthClientInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(OAuthClientInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "connectorId and clientId are required" }, { status: 400 });
  }
  try {
    await saveOAuthConnectorClient(input.connectorId.trim(), input.clientId);
    return Response.json(await getOAuthConnectorStatus(input.connectorId.trim()));
  } catch (error) {
    return failure(error instanceof Error ? error : null, "OAuth client could not be saved");
  }
}

export async function handleOAuthDisconnect(request: Request): Promise<Response> {
  const connectorId = new URL(request.url).searchParams.get("connectorId")?.trim();
  if (!connectorId) return Response.json({ error: "connectorId is required" }, { status: 400 });
  try {
    const status = await disconnectOAuthConnector(connectorId);
    closePooledConnection(connectorId);
    return Response.json(status);
  } catch (error) {
    return failure(error instanceof Error ? error : null, "OAuth disconnect failed");
  }
}
