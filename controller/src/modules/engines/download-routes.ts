import type { RouteRegistrar } from "../../http/route-registrar";
import { badRequest, notFound } from "../../core/errors";
import { parseJsonObjectBody } from "../../core/validation";

const resolveHfToken = (
  ctx: { req: { header: (name: string) => string | undefined } },
  body?: Record<string, unknown>,
): string | null => {
  const bodyToken = typeof body?.["hf_token"] === "string" ? String(body?.["hf_token"]) : null;
  const headerToken = ctx.req.header("x-hf-token") ?? ctx.req.header("x-huggingface-token") ?? null;
  const envToken =
    process.env["LOCAL_STUDIO_HF_TOKEN"] ??
    process.env["HF_TOKEN"] ??
    process.env["HUGGINGFACE_TOKEN"] ??
    null;
  return bodyToken || headerToken || envToken;
};

export const registerDownloadRoutes: RouteRegistrar = (app, context) => {
  app.get("/studio/downloads", async (ctx) => {
    const downloads = context.downloadManager.list();
    return ctx.json({ downloads });
  });

  app.get("/studio/downloads/:downloadId", async (ctx) => {
    const id = ctx.req.param("downloadId");
    const download = context.downloadManager.get(id);
    if (!download) throw notFound("Download not found");
    return ctx.json({ download });
  });

  app.post("/studio/downloads", async (ctx) => {
    const body = await parseJsonObjectBody(ctx);
    const modelId = typeof body["model_id"] === "string" ? body["model_id"] : null;
    if (!modelId) throw badRequest("model_id is required");
    const download = await context.downloadManager.start({
      model_id: modelId,
      revision: typeof body["revision"] === "string" ? body["revision"] : null,
      destination_dir: typeof body["destination_dir"] === "string" ? body["destination_dir"] : null,
      allow_patterns: Array.isArray(body["allow_patterns"])
        ? body["allow_patterns"].map(String)
        : null,
      ignore_patterns: Array.isArray(body["ignore_patterns"])
        ? body["ignore_patterns"].map(String)
        : null,
      hf_token: resolveHfToken(ctx, body),
    });
    return ctx.json({ download });
  });

  app.post("/studio/downloads/:downloadId/pause", async (ctx) => {
    const id = ctx.req.param("downloadId");
    if (!context.downloadManager.get(id)) throw notFound("Download not found");
    const download = context.downloadManager.pause(id);
    return ctx.json({ download });
  });

  app.post("/studio/downloads/:downloadId/resume", async (ctx) => {
    const body = await parseJsonObjectBody(ctx);
    const token = resolveHfToken(ctx, body);
    const id = ctx.req.param("downloadId");
    if (!context.downloadManager.get(id)) throw notFound("Download not found");
    const download = context.downloadManager.resume(id, token ?? null);
    return ctx.json({ download });
  });

  app.post("/studio/downloads/:downloadId/cancel", async (ctx) => {
    const id = ctx.req.param("downloadId");
    if (!context.downloadManager.get(id)) throw notFound("Download not found");
    const download = context.downloadManager.cancel(id);
    return ctx.json({ download });
  });
};
