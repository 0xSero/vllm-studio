import {
  ControllerWorkloadProbeSchema,
  type WorkloadIdentityEvidence,
} from "@local-studio/contracts/workload-identity";
import { loadWorkloadIdentityConfig } from "@local-studio/agent-runtime/spiffe-config";
import { fetchJwtSvid, validateJwtSvid } from "@local-studio/agent-runtime/spiffe-workload-api";
import { agentRuntimeBaseUrl } from "../proxy-to-runtime";
import { currentX509Svid, fetchWithX509Svid } from "@local-studio/agent-runtime/spiffe-x509";
import { getApiSettings } from "@local-studio/agent-runtime/settings-service";
import { enterpriseAuthConfig } from "@/lib/auth/enterprise-config";
import { ENTERPRISE_SESSION_COOKIE, getEnterpriseSession } from "@/lib/auth/enterprise-session";
import { acquireEnterpriseAccessToken } from "@/lib/auth/token-broker";
import { Schema } from "effect";

const unavailable = (required: boolean, detail: string): WorkloadIdentityEvidence => ({
  configured: true,
  required,
  state: "contradicted",
  spiffe_id: null,
  trust_domain: null,
  audience: null,
  expires_at: null,
  checked_at: new Date().toISOString(),
  jwt_svid_validated: false,
  x509_mtls: "not_verified",
  detail,
});

export async function GET(request: Request): Promise<Response> {
  const config = loadWorkloadIdentityConfig();
  if (!config || config.mode === "disabled") {
    return Response.json({
      configured: false,
      required: false,
      state: "unconfigured",
      spiffe_id: null,
      trust_domain: null,
      audience: null,
      expires_at: null,
      checked_at: null,
      jwt_svid_validated: false,
      x509_mtls: "not_verified",
      detail: "SPIFFE workload identity is not enabled.",
    } satisfies WorkloadIdentityEvidence);
  }
  try {
    const token = await fetchJwtSvid(
      config,
      config.agent_runtime_audience,
      config.frontend_id,
      request.signal,
    );
    const runtime = await fetchWithX509Svid(
      config,
      config.frontend_id,
      config.agent_runtime_id,
      `${agentRuntimeBaseUrl()}/ready`,
      {
        headers: { "x-spiffe-jwt-svid": token.svid },
        signal: request.signal,
        cache: "no-store",
      },
    );
    if (!runtime.ok) throw new Error("Agent runtime rejected workload identity");
    const settings = await getApiSettings();
    const controllerToken = await fetchJwtSvid(
      config,
      config.controller_audience,
      config.frontend_id,
      request.signal,
    );
    const controllerHeaders = new Headers({ "x-spiffe-jwt-svid": controllerToken.svid });
    const session = await getEnterpriseSession(
      request.headers
        .get("cookie")
        ?.split(";")
        .map((entry) => entry.trim().split("="))
        .find(([name]) => name === ENTERPRISE_SESSION_COOKIE)?.[1],
      enterpriseAuthConfig(),
    );
    if (session) {
      const lease = await acquireEnterpriseAccessToken(session);
      controllerHeaders.set("authorization", `Bearer ${lease.accessToken}`);
    } else if (settings.apiKey) {
      controllerHeaders.set("authorization", `Bearer ${settings.apiKey}`);
    }
    const controller = await fetchWithX509Svid(
      config,
      config.frontend_id,
      config.controller_id,
      `${settings.backendUrl.replace(/\/+$/u, "")}/environment/workload-identity`,
      { headers: controllerHeaders, signal: request.signal, cache: "no-store" },
    );
    if (!controller.ok) throw new Error("Controller rejected workload identity");
    const controllerEvidence = Schema.decodeUnknownSync(ControllerWorkloadProbeSchema)(
      await controller.json(),
    );
    if (
      !controllerEvidence.observed ||
      controllerEvidence.jwt_svid !== true ||
      (config.x509_mtls === "required" && controllerEvidence.x509_mtls !== true)
    ) {
      throw new Error("Controller workload probe failed");
    }
    const validated = await validateJwtSvid(
      config,
      config.agent_runtime_audience,
      token.svid,
      [config.frontend_id],
      request.signal,
    );
    const x509 = currentX509Svid(config, config.frontend_id);
    const mtlsObserved = config.x509_mtls === "required" && Boolean(x509);
    return Response.json({
      configured: true,
      required: config.mode === "required",
      state: "observed",
      spiffe_id: validated.spiffeId,
      trust_domain: config.trust_domain,
      audience: config.agent_runtime_audience,
      expires_at: validated.expiresAt,
      checked_at: new Date().toISOString(),
      jwt_svid_validated: true,
      x509_mtls:
        config.x509_mtls === "required"
          ? mtlsObserved
            ? "observed"
            : "contradicted"
          : config.x509_mtls === "optional"
            ? "not_verified"
            : "disabled",
      x509_svid_expires_at: x509?.expiresAt ?? null,
      x509_svid_serial: x509?.serialNumber ?? null,
      rotation_generation: x509?.generation ?? 0,
      hops: [
        {
          source: config.frontend_id,
          destination: config.agent_runtime_id,
          jwt_svid: true,
          x509_mtls: mtlsObserved,
          peer_id: config.agent_runtime_id,
        },
        {
          source: config.frontend_id,
          destination: config.controller_id,
          jwt_svid: true,
          x509_mtls: mtlsObserved,
          peer_id: config.controller_id,
        },
        {
          source: config.controller_id,
          destination: config.agent_runtime_id,
          jwt_svid: true,
          x509_mtls: controllerEvidence.x509_mtls === true,
          peer_id: config.agent_runtime_id,
        },
      ],
      detail: "SPIFFE workload identity was accepted on all commissioned service hops.",
    } satisfies WorkloadIdentityEvidence);
  } catch {
    return Response.json(
      unavailable(config.mode === "required", "SPIFFE Workload API issuance or validation failed."),
    );
  }
}
