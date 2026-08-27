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

const GoogleClientInputSchema = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
});

const GoogleDisconnectInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
  accountKey: Schema.String,
});

const GoogleAccountInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
});

function failure(error: Error | null, fallback = "Google account failed"): Response {
  const status = error instanceof GoogleAccountError ? error.status : 500;
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

async function closeGoogleConnections(): Promise<void> {
  try {
    for (const connector of await listConnectors()) {
      if (googleWorkspaceConnectorIdentity(connector.id)) closePooledConnection(connector.id);
    }
  } catch {}
}

export async function handleGoogleAccountGet(): Promise<Response> {
  try {
    return Response.json({ account: await Effect.runPromise(getGoogleAccount()) });
  } catch (error) {
    return failure(error instanceof Error ? error : null);
  }
}

export async function handleGoogleClientPut(request: Request): Promise<Response> {
  let input: typeof GoogleClientInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleClientInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "clientId must be a string" }, { status: 400 });
  }
  try {
    const account = await Effect.runPromise(saveGoogleClient(input));
    return Response.json({ account });
  } catch (error) {
    return failure(error instanceof Error ? error : null);
  } finally {
    await closeGoogleConnections();
  }
}

export async function handleGoogleAccountDisconnect(request: Request): Promise<Response> {
  let input: typeof GoogleDisconnectInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleDisconnectInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "account and accountKey are required" }, { status: 400 });
  }
  if (!GOOGLE_ACCOUNT_KEY_PATTERN.test(input.accountKey)) {
    return Response.json({ error: "accountKey is not a known account" }, { status: 400 });
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
    return failure(error instanceof Error ? error : null);
  } finally {
    await closeGoogleConnections();
  }
}

export async function handleGoogleAuthorizeBegin(request: Request): Promise<Response> {
  let input: typeof GoogleAccountInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAccountInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "account is required" }, { status: 400 });
  }
  try {
    return Response.json(await Effect.runPromise(beginGoogleLoopbackAuthorization(input.account)));
  } catch (error) {
    return failure(error instanceof Error ? error : null, "Google sign-in failed");
  }
}

export async function handleGoogleAuthorizeCancel(request: Request): Promise<Response> {
  let input: typeof GoogleAccountInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAccountInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "account is required" }, { status: 400 });
  }
  try {
    await Effect.runPromise(cancelGoogleLoopbackAuthorization(input.account));
    return Response.json({ cancelled: true });
  } catch (error) {
    return failure(error instanceof Error ? error : null, "Google sign-in cancellation failed");
  }
}
