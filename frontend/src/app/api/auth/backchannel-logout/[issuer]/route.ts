import { NextRequest, NextResponse } from "next/server";
import { readRequestBytesWithinLimit } from "@shared/agent/agent-turn-body";
import { emitEnterpriseAudit } from "@/lib/auth/enterprise-audit";
import { enterpriseIssuer } from "@/lib/auth/enterprise-config";
import { takeEnterpriseSessionsForLogout } from "@/lib/auth/enterprise-session";
import { revokeOidcSession, verifyBackchannelLogoutToken } from "@/lib/auth/oidc-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ issuer: string }> },
) {
  try {
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
    ) {
      throw new Error("OIDC back-channel logout content type is invalid");
    }
    const body = await readRequestBytesWithinLimit(request, 64 * 1024);
    if (!body.ok) throw new Error("OIDC back-channel logout body is invalid");
    const form = new URLSearchParams(new TextDecoder().decode(body.value));
    const tokens = form.getAll("logout_token");
    if (tokens.length !== 1 || !tokens[0]) {
      throw new Error("OIDC back-channel logout token is missing");
    }
    const { issuer: issuerId } = await params;
    const issuer = enterpriseIssuer(issuerId);
    const token = await verifyBackchannelLogoutToken(issuer, tokens[0]);
    const deletion = await takeEnterpriseSessionsForLogout(
      token.issuer,
      issuer.id,
      token.jti,
      token.expiresAt,
      {
        ...(token.sid ? { sid: token.sid } : {}),
        ...(token.subject ? { subject: token.subject } : {}),
      },
    );
    const { result } = deletion;
    if (result.replayed) throw new Error("OIDC back-channel logout token was replayed");
    const revocations = issuer.scopes.includes("offline_access")
      ? []
      : await Promise.allSettled(
          deletion.sessions
            .filter((session) => session.refreshToken)
            .map((session) => revokeOidcSession(issuer, session.refreshToken)),
        );
    const revocationFailed = revocations.some(
      (revocation) => revocation.status === "rejected" || revocation.value === false,
    );
    const revocationState = issuer.scopes.includes("offline_access")
      ? "retained_offline"
      : revocations.length === 0
        ? "not_available"
        : revocationFailed
          ? "failed"
          : "observed";
    emitEnterpriseAudit({
      event: "backchannel_logout",
      issuer_id: issuer.id,
      reason:
        result.deleted === 0
          ? "session_not_found"
          : `sessions_deleted:${result.deleted};revocation:${revocationState}`,
    });
    return new NextResponse(null, { status: 200, headers: noStore });
  } catch {
    emitEnterpriseAudit({
      event: "session_denied",
      reason: "backchannel_logout_validation_failed",
    });
    return NextResponse.json(
      { error: "OIDC back-channel logout rejected" },
      { status: 400, headers: noStore },
    );
  }
}
