import { createServer, type Server, type ServerResponse } from "node:http";
import { Effect, Fiber } from "effect";
import {
  beginGoogleAuthorization,
  cancelGoogleAuthorization,
  completeGoogleAuthorizationWithActivation,
  createGoogleAuthorizationFlow,
  GoogleAccountError,
} from "./google-account";
import {
  enableGoogleWorkspaceAdapter,
  googleWorkspaceAdapterEnabled,
  restoreGoogleWorkspaceAdapter,
} from "./google-workspace-adapter";
import type { GoogleWorkspacePluginId } from "./google-workspace-binding";
import { createOAuthLoopbackLifecycle } from "./oauth-loopback-lifecycle";

type ActiveFlow = {
  id: string;
  server: Server;
  timeout: Fiber.Fiber<void, unknown>;
};

const activeFlows = new Map<GoogleWorkspacePluginId, ActiveFlow>();
const loopbackLifecycles = {
  gmail: createOAuthLoopbackLifecycle(),
  "google-calendar": createOAuthLoopbackLifecycle(),
};

function page(response: ServerResponse, success: boolean, activated: boolean): Promise<void> {
  const title = success ? "Google Workspace connected" : "Google sign-in failed";
  const status = success ? "Connection complete" : "Action needed";
  const message = !success
    ? "Return to Local Studio and start Google sign-in again."
    : activated
      ? "The read-only plugin is ready in Local Studio. You can close this tab."
      : "The account is connected. Return to Local Studio to finish enabling the plugin.";
  const role = success ? "status" : "alert";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>:root{color-scheme:light dark;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:1.5rem;background:Canvas;color:CanvasText}main{width:min(100%,32rem);padding:2rem;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:1rem;background:color-mix(in srgb,Canvas 94%,CanvasText 6%);box-shadow:0 1.5rem 4rem color-mix(in srgb,CanvasText 10%,transparent)}.brand{margin:0 0 2.5rem;font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.status{margin:0 0 .75rem;font-size:.8125rem;font-weight:650;color:color-mix(in srgb,CanvasText 68%,transparent)}h1{margin:0;font-size:clamp(1.5rem,5vw,2rem);line-height:1.15;letter-spacing:-.025em}p:last-child{margin:1rem 0 0;color:color-mix(in srgb,CanvasText 68%,transparent);line-height:1.6}</style></head><body><main><p class="brand">Local Studio</p><p class="status" role="${role}">${status}</p><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    response.once("finish", finish);
    response.once("close", finish);
    response.once("error", finish);
    response.writeHead(success ? 200 : 400, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      connection: "close",
    });
    response.end(html);
  });
}

function closeFlow(
  account: GoogleWorkspacePluginId,
  expectedId?: string,
  interruptTimeout = true,
): void {
  const flow = activeFlows.get(account);
  if (!flow || (expectedId && flow.id !== expectedId)) return;
  activeFlows.delete(account);
  flow.server.closeAllConnections();
  flow.server.close();
  if (interruptTimeout) void Effect.runPromise(Fiber.interrupt(flow.timeout));
}

async function handleCallback(
  account: GoogleWorkspacePluginId,
  flowId: string,
  requestUrl: string,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(requestUrl, "http://127.0.0.1");
  if (url.pathname !== "/callback") {
    response.writeHead(404).end();
    return;
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !state || !code) {
    await page(response, false, false);
    closeFlow(account, flowId);
    return;
  }
  try {
    const adapterWasEnabled = await Effect.runPromise(googleWorkspaceAdapterEnabled(account));
    const result = await Effect.runPromise(
      completeGoogleAuthorizationWithActivation(
        account,
        { state, code },
        flowId,
        (signal) =>
          enableGoogleWorkspaceAdapter(account, signal).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          ),
        restoreGoogleWorkspaceAdapter(account, adapterWasEnabled),
      ),
    );
    await page(response, true, result.activation);
    closeFlow(account, flowId);
  } catch (error) {
    await page(response, false, false);
    if (!(error instanceof GoogleAccountError && error.message.includes("state is invalid"))) {
      closeFlow(account, flowId);
    }
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Loopback listener failed"));
        return;
      }
      resolve(address.port);
    });
  });
}

export function beginGoogleLoopbackAuthorization(
  account: GoogleWorkspacePluginId,
): Effect.Effect<{ authorizationUrl: string }, GoogleAccountError> {
  return loopbackLifecycles[account].start(
    Effect.gen(function* () {
      closeFlow(account);
      const flowId = createGoogleAuthorizationFlow(account);
      const server = createServer((request, response) => {
        void handleCallback(account, flowId, request.url ?? "/", response);
      });
      const port = yield* Effect.tryPromise({
        try: () => listen(server),
        catch: () => new GoogleAccountError(500, "Could not start the private OAuth callback"),
      });
      server.on("error", () => closeFlow(account, flowId));
      const timeout = Effect.runFork(
        Effect.gen(function* () {
          yield* Effect.sleep(10 * 60 * 1000);
          closeFlow(account, flowId, false);
        }),
      );
      activeFlows.set(account, { id: flowId, server, timeout });
      return yield* beginGoogleAuthorization(
        account,
        `http://127.0.0.1:${port}/callback`,
        undefined,
        undefined,
        flowId,
      ).pipe(Effect.tapError(() => Effect.sync(() => closeFlow(account, flowId))));
    }),
  );
}

export function cancelGoogleLoopbackAuthorization(
  account: GoogleWorkspacePluginId,
): Effect.Effect<void, GoogleAccountError> {
  return loopbackLifecycles[account].cancel(
    cancelGoogleAuthorization(account),
    Effect.sync(() => closeFlow(account)),
  );
}
