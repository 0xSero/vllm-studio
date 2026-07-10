import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import { GoogleAccountError } from "@local-studio/agent-runtime/google-account";
import {
  beginGoogleLoopbackAuthorization,
  cancelGoogleLoopbackAuthorization,
} from "@local-studio/agent-runtime/google-oauth-loopback";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GoogleAccountInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
});

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof GoogleAccountInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAccountInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "account is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await Effect.runPromise(beginGoogleLoopbackAuthorization(input.account)),
    );
  } catch (error) {
    const status = error instanceof GoogleAccountError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Google sign-in failed" },
      { status },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof GoogleAccountInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAccountInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "account is required" }, { status: 400 });
  }
  try {
    await Effect.runPromise(cancelGoogleLoopbackAuthorization(input.account));
    return NextResponse.json({ cancelled: true });
  } catch (error) {
    const status = error instanceof GoogleAccountError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Google sign-in cancellation failed" },
      { status },
    );
  }
}
