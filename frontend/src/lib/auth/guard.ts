import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_HEADER,
  presentedToken,
  resolveAccessPosture,
} from "./access";

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
export function requireApiAccess(request: NextRequest): Response | null {
  const posture = resolveAccessPosture();
  if (posture.kind === "allow") return null;
  const presented = presentedToken(
    request.headers.get(STUDIO_TOKEN_HEADER),
    request.cookies.get(STUDIO_TOKEN_COOKIE)?.value,
  );
  if (presented && safeEqual(presented, posture.token)) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
