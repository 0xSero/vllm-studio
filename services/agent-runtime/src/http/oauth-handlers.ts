//
// HTTP surface for click-to-connect OAuth on catalog connectors. The routes
// are deliberately generic — the connector id selects a provider definition,
// the engine picks the flow — so adding a provider is a registry entry, not a
// new endpoint. Tokens never travel through these responses: status reports
// who is connected, authorize reports what the user must click, and that is
// the entire vocabulary.
//

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
import { decodeBody, errorMessage, jsonError } from "./helpers";

function failure(error: unknown, fallback: string): Response {
  return jsonError(
    errorMessage(error, fallback),
    error instanceof OAuthConnectorError ? error.status : 500,
  );
}

/** The writes name their connector in the body, the reads in ?connectorId. */
async function connectorIdFromBody(request: Request): Promise<string | null> {
  try {
    const input = Schema.decodeUnknownSync(OAuthConnectorInputSchema)(await request.json());
    return input.connectorId.trim() || null;
  } catch {
    return null;
  }
}

const connectorIdFromQuery = (request: Request): string | null =>
  new URL(request.url).searchParams.get("connectorId")?.trim() || null;

export async function handleOAuthAuthorizeBegin(request: Request): Promise<Response> {
  const connectorId = await connectorIdFromBody(request);
  if (!connectorId) return jsonError("connectorId is required");
  try {
    return Response.json(await beginOAuthConnectorAuthorization(connectorId));
  } catch (error) {
    return failure(error, "OAuth sign-in failed");
  }
}

export async function handleOAuthAuthorizeCancel(request: Request): Promise<Response> {
  const connectorId = await connectorIdFromBody(request);
  if (!connectorId) return jsonError("connectorId is required");
  try {
    cancelOAuthConnectorAuthorization(connectorId);
    return Response.json({ cancelled: true });
  } catch (error) {
    return failure(error, "OAuth cancellation failed");
  }
}

export async function handleOAuthStatus(request: Request): Promise<Response> {
  const connectorId = connectorIdFromQuery(request);
  if (!connectorId) return jsonError("connectorId is required");
  try {
    return Response.json(await getOAuthConnectorStatus(connectorId));
  } catch (error) {
    return failure(error, "OAuth status failed");
  }
}

export async function handleOAuthClientPut(request: Request): Promise<Response> {
  const input = await decodeBody(
    request,
    OAuthClientInputSchema,
    "connectorId and clientId are required",
  );
  if (input instanceof Response) return input;
  const connectorId = input.connectorId.trim();
  try {
    await saveOAuthConnectorClient(connectorId, input.clientId);
    return Response.json(await getOAuthConnectorStatus(connectorId));
  } catch (error) {
    return failure(error, "OAuth client could not be saved");
  }
}

export async function handleOAuthDisconnect(request: Request): Promise<Response> {
  const connectorId = connectorIdFromQuery(request);
  if (!connectorId) return jsonError("connectorId is required");
  try {
    const status = await disconnectOAuthConnector(connectorId);
    // A pooled child spawned with the old token keeps running otherwise.
    closePooledConnection(connectorId);
    return Response.json(status);
  } catch (error) {
    return failure(error, "OAuth disconnect failed");
  }
}
