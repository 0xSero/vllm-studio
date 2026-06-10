import { badRequest, notFound } from "../../core/errors";
import { parseJsonObjectBody } from "../../core/validation";
import type { RouteRegistrar } from "../../http/route-registrar";
import { savePersistedConfig, type ProviderConfig } from "../../config/persisted-config";

/** CRUD for external inference providers plus model discovery across them. */
export const registerStudioProviderRoutes: RouteRegistrar = (app, context) => {
  app.get("/studio/providers", async (ctx) => {
    const providers = context.config.providers.map((p) => ({
      id: p.id,
      name: p.name,
      base_url: p.base_url,
      enabled: p.enabled,
      has_api_key: Boolean(p.api_key),
    }));
    return ctx.json({ providers });
  });

  app.post("/studio/providers", async (ctx) => {
    const body = await parseJsonObjectBody(ctx);

    const id = typeof body["id"] === "string" ? body["id"].trim().toLowerCase() : "";
    const name = typeof body["name"] === "string" ? body["name"].trim() : "";
    const baseUrl = typeof body["base_url"] === "string" ? body["base_url"].trim() : "";
    const apiKey = typeof body["api_key"] === "string" ? body["api_key"].trim() : "";
    const enabled = typeof body["enabled"] === "boolean" ? body["enabled"] : true;

    if (!id) throw badRequest("id is required");
    if (!name) throw badRequest("name is required");
    if (!baseUrl) throw badRequest("base_url is required");

    const existing = context.config.providers.find((p) => p.id === id);
    if (existing) throw badRequest(`Provider "${id}" already exists`);

    const provider: ProviderConfig = { id, name, base_url: baseUrl, api_key: apiKey, enabled };
    const providers = [...context.config.providers, provider];
    savePersistedConfig(context.config.data_dir, { providers });
    context.config.providers = providers;

    return ctx.json({
      success: true,
      provider: { id, name, base_url: baseUrl, enabled, has_api_key: Boolean(apiKey) },
    });
  });

  app.put("/studio/providers/:id", async (ctx) => {
    const providerId = ctx.req.param("id");
    const body = await ctx.req.json().catch(() => ({}));
    if (!body || typeof body !== "object") throw badRequest("Invalid payload");

    const index = context.config.providers.findIndex((p) => p.id === providerId);
    if (index < 0) throw notFound(`Provider "${providerId}" not found`);

    const current = context.config.providers[index];
    if (!current) throw notFound(`Provider "${providerId}" not found`);

    const name = typeof body.name === "string" ? body.name.trim() : current.name;
    const baseUrl = typeof body.base_url === "string" ? body.base_url.trim() : current.base_url;
    const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : current.api_key;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : current.enabled;

    const updated: ProviderConfig = {
      id: providerId,
      name,
      base_url: baseUrl,
      api_key: apiKey,
      enabled,
    };
    const providers = [...context.config.providers];
    providers[index] = updated;
    savePersistedConfig(context.config.data_dir, { providers });
    context.config.providers = providers;

    return ctx.json({
      success: true,
      provider: { id: providerId, name, base_url: baseUrl, enabled, has_api_key: Boolean(apiKey) },
    });
  });

  app.delete("/studio/providers/:id", async (ctx) => {
    const providerId = ctx.req.param("id");
    const index = context.config.providers.findIndex((p) => p.id === providerId);
    if (index < 0) throw notFound(`Provider "${providerId}" not found`);

    const providers = context.config.providers.filter((p) => p.id !== providerId);
    savePersistedConfig(context.config.data_dir, { providers });
    context.config.providers = providers;

    return ctx.json({ success: true });
  });

  // Fetch models from all configured providers
  app.get("/studio/provider-models", async (ctx) => {
    const enabledProviders = context.config.providers.filter((p) => p.enabled && p.api_key);
    const results: Array<{ provider: string; models: Array<{ id: string; name?: string }> }> = [];

    await Promise.all(
      enabledProviders.map(async (provider) => {
        try {
          const url = `${provider.base_url.replace(/\/+$/, "")}/v1/models`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${provider.api_key}` },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { data?: Array<{ id?: string }> };
          const models = (data.data ?? [])
            .filter((m) => typeof m.id === "string" && m.id.length > 0)
            .map((m) => ({ id: m.id as string }));
          results.push({ provider: provider.id, models });
        } catch {
          // skip unreachable providers
        }
      })
    );

    return ctx.json({ providers: results });
  });
};
