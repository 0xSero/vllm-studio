import { loadWorkloadIdentityConfig } from "@local-studio/agent-runtime/spiffe-config";
import { fetchJwtSvid } from "@local-studio/agent-runtime/spiffe-workload-api";
import { fetchWithX509Svid } from "@local-studio/agent-runtime/spiffe-x509";
import { Effect } from "effect";

export const controllerWorkloadEvidence = (signal: AbortSignal): Effect.Effect<Response> => {
  const config = loadWorkloadIdentityConfig();
  if (!config || config.mode === "disabled") {
    return Effect.succeed(Response.json({ configured: false, observed: false }));
  }
  return Effect.tryPromise({
    try: async () => {
      const identity = await fetchJwtSvid(
        config,
        config.agent_runtime_audience,
        config.controller_id,
        signal,
      );
      const runtime = (
        process.env["LOCAL_STUDIO_AGENT_RUNTIME_URL"] ?? "http://127.0.0.1:8081"
      ).replace(/\/+$/u, "");
      const response = await fetchWithX509Svid(
        config,
        config.controller_id,
        config.agent_runtime_id,
        `${runtime}/ready`,
        {
          headers: { "x-spiffe-jwt-svid": identity.svid },
          signal,
        },
      );
      if (!response.ok) throw new Error("Agent runtime rejected controller workload identity");
      return Response.json({
        configured: true,
        observed: true,
        source: config.controller_id,
        destination: config.agent_runtime_id,
        jwt_svid: true,
        x509_mtls: config.x509_mtls === "required",
      });
    },
    catch: (error) => error,
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        Response.json(
          { configured: true, observed: false },
          { status: config.mode === "required" ? 503 : 200 },
        ),
      ),
    ),
  );
};
