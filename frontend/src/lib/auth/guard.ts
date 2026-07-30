import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_HEADER,
  presentedToken,
  resolveAccessPosture,
} from "./access";
import { enterpriseAuthConfig } from "./enterprise-config";
import { ENTERPRISE_SESSION_COOKIE, getEnterpriseSession } from "./enterprise-session";
import {
  enterpriseOperationDenial,
  enterpriseOperationPolicy,
} from "@local-studio/contracts/enterprise-authorization";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Length check first; timingSafeEqual throws on mismatched lengths.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Node-runtime access guard for privileged API routes. Returns a Response when
// access is denied, or null when the caller may proceed. This is authoritative
// defense-in-depth: even if the edge middleware gate is bypassed or misrouted,
// the crown-jewel routes (terminal, agent turn, filesystem) self-check here in a
// runtime where reading process.env at request time is guaranteed.
export async function requireApiAccess(request: NextRequest): Promise<Response | null> {
  const config = enterpriseAuthConfig();
  const posture = resolveAccessPosture({ enterpriseMode: config?.mode ?? null });
  if (posture.kind === "allow") return null;
  if (posture.kind === "misconfigured") {
    return Response.json(
      { error: "Shared deployment authentication is not configured" },
      {
        status: 503,
      },
    );
  }
  if (posture.kind === "require-oidc" || posture.kind === "optional-oidc") {
    const sessionId = request.cookies.get(ENTERPRISE_SESSION_COOKIE)?.value;
    const session = await getEnterpriseSession(sessionId, config);
    const policy = enterpriseOperationPolicy(request.method, request.nextUrl.pathname);
    if (session) {
      if (policy && enterpriseOperationDenial(session.principal, policy)) {
        return Response.json({ error: "Enterprise authorization denied" }, { status: 403 });
      }
      return null;
    }
    if (posture.kind === "optional-oidc" && !sessionId && !policy) return null;
    return Response.json({ error: "Enterprise sign-in required" }, { status: 401 });
  }
  const presented = presentedToken(
    request.headers.get(STUDIO_TOKEN_HEADER),
    request.cookies.get(STUDIO_TOKEN_COOKIE)?.value,
  );
  if (presented && safeEqual(presented, posture.token)) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
