import type { Context } from "hono";
import { findObservedInferenceProcess } from "../../core/function-observability";
import type { RouteRegistrar } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";
import type { ProcessInfo } from "../models/types";
import { fetchInference } from "../../http/local-fetch";
import { normalizeToolRequest } from "./content-normalizer";

const withRunningModel =
  (
    context: AppContext,
    observedName: string,
    emptyPayload: Record<string, unknown>,
    handler: (ctx: Context, current: ProcessInfo, body: Record<string, unknown>) => Promise<Response>
  ) =>
  async (ctx: Context): Promise<Response> => {
    const current = await findObservedInferenceProcess(context, observedName);
    if (!current) {
      return ctx.json({ error: "No model running", ...emptyPayload });
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch (error) {
      return ctx.json({ error: String(error), ...emptyPayload });
    }
    return handler(ctx, current, body);
  };

export const registerTokenizationRoutes: RouteRegistrar = (app, context) => {
  app.post(
    "/v1/tokenize",
    withRunningModel(context, "tokenize", { num_tokens: 0 }, async (ctx, _current, body) => {
      try {
        const response = await fetchInference(context, "/tokenize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.status === 200) {
          return ctx.json(await response.json());
        }
        return ctx.json({ error: `Tokenization failed: ${response.status}`, num_tokens: 0 });
      } catch (error) {
        return ctx.json({ error: String(error), num_tokens: 0 });
      }
    })
  );

  app.post(
    "/v1/detokenize",
    withRunningModel(context, "detokenize", { text: "" }, async (ctx, _current, body) => {
      try {
        const response = await fetchInference(context, "/detokenize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.status === 200) {
          return ctx.json(await response.json());
        }
        return ctx.json({ error: `Detokenization failed: ${response.status}`, text: "" });
      } catch (error) {
        return ctx.json({ error: String(error), text: "" });
      }
    })
  );

  app.post(
    "/v1/count-tokens",
    withRunningModel(context, "countTokens", { num_tokens: 0 }, async (ctx, current, body) => {
      const text = typeof body["text"] === "string" ? body["text"] : "";
      const model =
        typeof body["model"] === "string" ? body["model"] : (current.served_model_name ?? "default");
      try {
        const response = await fetchInference(context, "/tokenize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: text }),
        });
        if (response.status === 200) {
          const data = (await response.json()) as { tokens?: unknown[] };
          const tokens = Array.isArray(data.tokens) ? data.tokens : [];
          return ctx.json({ num_tokens: tokens.length, model });
        }
        return ctx.json({ error: `Token count failed: ${response.status}`, num_tokens: 0 });
      } catch (error) {
        return ctx.json({ error: String(error), num_tokens: 0 });
      }
    })
  );

  app.post(
    "/v1/tokenize-chat-completions",
    withRunningModel(
      context,
      "tokenizeChatCompletions",
      { input_tokens: 0 },
      async (ctx, current, body) => {
        const messages = Array.isArray(body["messages"]) ? body["messages"] : [];
        const tools = Array.isArray(body["tools"]) ? body["tools"] : [];
        const model =
          typeof body["model"] === "string"
            ? body["model"]
            : (current.served_model_name ?? "default");

        try {
          const testRequest: Record<string, unknown> = {
            model,
            messages,
            max_tokens: 1,
            stream: false,
          };
          if (tools.length > 0) {
            testRequest["tools"] = tools;
          }
          normalizeToolRequest(testRequest);
          const response = await fetchInference(context, "/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(testRequest),
          });
          if (response.status === 200) {
            const data = (await response.json()) as { usage?: Record<string, number> };
            const promptTokens = data.usage?.["prompt_tokens"] ?? 0;
            return ctx.json({
              input_tokens: promptTokens,
              breakdown: { messages: promptTokens, tools: 0 },
              model,
            });
          }
        } catch {}

        let messagesTokens = 0;
        let toolsTokens = 0;
        try {
          let allText = "";
          for (const message of messages) {
            const record = message as Record<string, unknown>;
            const content = record["content"];
            if (typeof content === "string") {
              allText += `${content}\n`;
            } else if (Array.isArray(content)) {
              for (const part of content) {
                const partRecord = part as Record<string, unknown>;
                if (partRecord["type"] === "text") {
                  allText += `${String(partRecord["text"] ?? "")}\n`;
                }
              }
            }
          }

          const response = await fetchInference(context, "/tokenize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, prompt: allText }),
          });
          if (response.status === 200) {
            const data = (await response.json()) as { tokens?: unknown[] };
            messagesTokens = Array.isArray(data.tokens) ? data.tokens.length : 0;
          }

          if (tools.length > 0) {
            const toolsText = JSON.stringify(tools);
            const toolsResponse = await fetchInference(context, "/tokenize", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model, prompt: toolsText }),
            });
            if (toolsResponse.status === 200) {
              const data = (await toolsResponse.json()) as { tokens?: unknown[] };
              toolsTokens = Array.isArray(data.tokens) ? data.tokens.length : 0;
            }
          }
        } catch {}

        const overhead = messages.length * 4;
        return ctx.json({
          input_tokens: messagesTokens + toolsTokens + overhead,
          breakdown: {
            messages: messagesTokens + overhead,
            tools: toolsTokens,
          },
          model,
        });
      }
    )
  );
};
