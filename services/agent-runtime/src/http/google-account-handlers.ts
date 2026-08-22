//
// HTTP surface for the Google account: client credentials, connection status,
// disconnects, and the loopback OAuth authorization flow. Moved verbatim from
// the Next route handlers so a remote runtime owns the Google binding — the
// loopback OAuth listener must run in the process the connectors run in.
//

import { Effect, Schema } from "effect";
import {
  disconnectGoogleAccount,
  getGoogleAccount,
  GoogleAccountError,
  saveGoogleClient,
} from "../google-account";
import { closePooledConnection } from "../connector-pool";
import { listConnectors } from "../connectors-service";
import { disableGoogleWorkspaceAdapter } from "../google-workspace-adapter";
import {
  GOOGLE_ACCOUNT_KEY_PATTERN,
  googleWorkspaceConnectorIdentity,
} from "../google-workspace-binding";
import {
  beginGoogleLoopbackAuthorization,
  cancelGoogleLoopbackAuthorization,
} from "../google-oauth-loopback";
import { decodeBody, errorMessage, jsonError } from "./helpers";

const GoogleService = Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]);

const GoogleClientInputSchema = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
});

const GoogleDisconnectInputSchema = Schema.Struct({
  account: GoogleService,
  accountKey: Schema.String,
});

const GoogleAccountInputSchema = Schema.Struct({ account: GoogleService });

function failure(error: unknown, fallback = "Google account failed"): Response {
  return jsonError(
    errorMessage(error, fallback),
    error instanceof GoogleAccountError ? error.status : 500,
  );
}

/** Pooled sockets outlive a credential change, so every managed row is dropped. */
async function closeGoogleConnections(): Promise<void> {
  try {
    for (const connector of await listConnectors()) {
      if (googleWorkspaceConnectorIdentity(connector.id)) closePooledConnection(connector.id);
    }
  } catch {
    // A connector file we cannot read has no live pooled connections to close.
  }
}

export async function handleGoogleAccountGet(): Promise<Response> {
  try {
    return Response.json({ account: await Effect.runPromise(getGoogleAccount()) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleGoogleClientPut(request: Request): Promise<Response> {
  const input = await decodeBody(request, GoogleClientInputSchema, "clientId must be a string");
  if (input instanceof Response) return input;
  try {
    return Response.json({ account: await Effect.runPromise(saveGoogleClient(input)) });
  } catch (error) {
    return failure(error);
  } finally {
    await closeGoogleConnections();
  }
}

export async function handleGoogleAccountDisconnect(request: Request): Promise<Response> {
  const input = await decodeBody(
    request,
    GoogleDisconnectInputSchema,
    "account and accountKey are required",
  );
  if (input instanceof Response) return input;
  if (!GOOGLE_ACCOUNT_KEY_PATTERN.test(input.accountKey)) {
    return jsonError("accountKey is not a known account");
  }
  const identity = { service: input.account, accountKey: input.accountKey };
  try {
    const account = await Effect.runPromise(
      Effect.gen(function* () {
        const disconnected = yield* disconnectGoogleAccount(identity);
        yield* disableGoogleWorkspaceAdapter(identity).pipe(
          Effect.mapError((error) => new GoogleAccountError(500, error.message)),
        );
        return disconnected;
      }),
    );
    return Response.json({ account });
  } catch (error) {
    return failure(error);
  } finally {
    await closeGoogleConnections();
  }
}

/** Both authorize routes name their service the same way and fail the same way. */
async function withGoogleService(
  request: Request,
  fallback: string,
  run: (account: (typeof GoogleAccountInputSchema.Type)["account"]) => Promise<Response>,
): Promise<Response> {
  const input = await decodeBody(request, GoogleAccountInputSchema, "account is required");
  if (input instanceof Response) return input;
  try {
    return await run(input.account);
  } catch (error) {
    return failure(error, fallback);
  }
}

export function handleGoogleAuthorizeBegin(request: Request): Promise<Response> {
  return withGoogleService(request, "Google sign-in failed", async (account) =>
    Response.json(await Effect.runPromise(beginGoogleLoopbackAuthorization(account))),
  );
}

export function handleGoogleAuthorizeCancel(request: Request): Promise<Response> {
  return withGoogleService(request, "Google sign-in cancellation failed", async (account) => {
    await Effect.runPromise(cancelGoogleLoopbackAuthorization(account));
    return Response.json({ cancelled: true });
  });
}
