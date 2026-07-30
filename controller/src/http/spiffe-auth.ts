import type { MiddlewareHandler } from "hono";
import type { TLSSocket } from "node:tls";
import {
  loadWorkloadIdentityConfig,
  resolveX509MtlsMode,
} from "@local-studio/agent-runtime/spiffe-config";
import {
  isWorkloadApiUnavailable,
  validateJwtSvid,
} from "@local-studio/agent-runtime/spiffe-workload-api";
import {
  readyX509Svid,
  validateX509RequestProof,
  validateX509PeerSocket,
} from "@local-studio/agent-runtime/spiffe-x509";
import { Effect } from "effect";
import { effectMiddleware, type ControllerEnvironment } from "./effect-handler";

export const createSpiffeAuthMiddleware = (): MiddlewareHandler<ControllerEnvironment> => {
  const config = loadWorkloadIdentityConfig();
  return effectMiddleware((context, next) =>
    Effect.tryPromise({
      try: async () => {
        if (!config || config.mode === "disabled" || context.req.path === "/health") {
          return next();
        }
        const admittedIds = [config.frontend_id, config.agent_runtime_id];
        const token = context.req.header("x-spiffe-jwt-svid")?.trim();
        if (!token) {
          if (config.mode === "required") {
            return context.json({ detail: "Workload identity required" }, { status: 401 });
          }
          return next();
        }
        try {
          const jwt = await validateJwtSvid(
            config,
            config.controller_audience,
            token,
            admittedIds,
            context.req.raw.signal,
          );
          const x509Mode = resolveX509MtlsMode(config);
          if (x509Mode !== "disabled") {
            const socket = context.env?.incoming?.socket as TLSSocket | undefined;
            if (!socket?.encrypted) {
              if (x509Mode === "required") {
                return context.json({ detail: "mTLS workload identity required" }, { status: 401 });
              }
            } else {
              let peer: string;
              try {
                peer = validateX509PeerSocket(socket, admittedIds);
              } catch (error) {
                if (socket.authorized !== undefined) throw error;
                const bundle = await readyX509Svid(config, config.controller_id);
                peer = validateX509RequestProof(context.req.raw, bundle, admittedIds);
              }
              if (peer !== jwt.spiffeId) {
                return context.json(
                  { detail: "Workload identities do not match" },
                  { status: 401 },
                );
              }
              context.header("X-Local-Studio-mTLS", "observed");
            }
          }
          context.set("workloadSpiffeId", jwt.spiffeId);
          context.header("X-Local-Studio-Workload-ID", jwt.spiffeId);
          return next();
        } catch (error) {
          return isWorkloadApiUnavailable(error)
            ? context.json({ detail: "Workload identity service unavailable" }, { status: 503 })
            : context.json({ detail: "Invalid workload identity" }, { status: 401 });
        }
      },
      catch: (error) => error,
    }),
  );
};
