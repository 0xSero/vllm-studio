import { Effect } from "effect";
import { protectManagedConnector, type ConnectorConfig } from "./connectors-service";
import { googleAuthorizationHeaders } from "./google-account";
import { googleWorkspaceConnectorAccount } from "./google-workspace-binding";

export async function connectorAuthorizationHeaders(
  connector: ConnectorConfig,
  forceRefresh: boolean,
): Promise<Record<string, string>> {
  const protectedConnector = protectManagedConnector(connector);
  const reference = protectedConnector.auth;
  const account = googleWorkspaceConnectorAccount(protectedConnector.id);
  if (
    reference?.type === "oauth" &&
    reference.provider === "google-workspace" &&
    account &&
    reference.account === account
  ) {
    return Effect.runPromise(googleAuthorizationHeaders(account, forceRefresh));
  }
  throw new Error("Unsupported connector authorization provider");
}
