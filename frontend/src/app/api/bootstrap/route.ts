import { Effect, Schema } from "effect";
import { NextRequest, NextResponse } from "next/server";
import { controllerBaseUrl } from "@/app/api/agent/proxy-to-controller";
import { CSRF_BOOTSTRAP_HEADER, CSRF_COOKIE } from "@/lib/security/request-boundary";
import { HarnessCatalogSchema } from "@shared/agent/harness-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiKey = process.env.LOCAL_STUDIO_API_KEY?.trim();
  const catalog = await Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${controllerBaseUrl()}/api/agent/harnesses`, {
          cache: "no-store",
          headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
          signal: request.signal,
        });
        if (!response.ok) throw new Error(`Harness discovery failed: ${response.status}`);
        return Schema.decodeUnknownSync(HarnessCatalogSchema)(await response.json());
      },
      catch: (cause) => cause,
    }).pipe(Effect.catch(() => Effect.succeed({ harnesses: [] }))),
  );
  return NextResponse.json({
    csrfToken:
      request.headers.get(CSRF_BOOTSTRAP_HEADER) ?? request.cookies.get(CSRF_COOKIE)?.value ?? null,
    harnesses: catalog.harnesses,
  });
}
