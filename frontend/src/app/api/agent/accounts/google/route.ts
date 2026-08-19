import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import {
  disconnectGoogleAccount,
  getGoogleAccount,
  GoogleAccountError,
  saveGoogleClient,
} from "@local-studio/agent-runtime/google-account";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { listConnectors } from "@local-studio/agent-runtime/connectors-service";
import { disableGoogleWorkspaceAdapter } from "@local-studio/agent-runtime/google-workspace-adapter";
import {
  GOOGLE_ACCOUNT_KEY_PATTERN,
  googleWorkspaceConnectorIdentity,
} from "@local-studio/agent-runtime/google-workspace-binding";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GoogleClientInputSchema = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
});

const GoogleDisconnectInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
  accountKey: Schema.String,
});

function failure(error: unknown) {
  const status = error instanceof GoogleAccountError ? error.status : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Google account failed" },
    { status },
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

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ account: await Effect.runPromise(getGoogleAccount()) });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof GoogleClientInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleClientInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "clientId must be a string" }, { status: 400 });
  }
  try {
    const account = await Effect.runPromise(saveGoogleClient(input));
    return NextResponse.json({ account });
  } catch (error) {
    return failure(error);
  } finally {
    await closeGoogleConnections();
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof GoogleDisconnectInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleDisconnectInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "account and accountKey are required" }, { status: 400 });
  }
  if (!GOOGLE_ACCOUNT_KEY_PATTERN.test(input.accountKey)) {
    return NextResponse.json({ error: "accountKey is not a known account" }, { status: 400 });
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
    return NextResponse.json({ account });
  } catch (error) {
    return failure(error);
  } finally {
    await closeGoogleConnections();
  }
}
