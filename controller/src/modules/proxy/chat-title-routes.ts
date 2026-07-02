import type { RouteRegistrar } from "../../http/route-registrar";
import { fetchInference } from "../../http/local-fetch";

export const registerChatTitleRoutes: RouteRegistrar = (app, context) => {
  app.post("/api/title", async (ctx) => {
    try {
      let body: Record<string, unknown> = {};
      try {
        body = (await ctx.req.json()) as Record<string, unknown>;
      } catch {
        return ctx.json({ title: "New Chat" });
      }
      const model = typeof body["model"] === "string" ? body["model"] : undefined;
      const userMessage = typeof body["user"] === "string" ? body["user"] : "";
      const assistantMessage = typeof body["assistant"] === "string" ? body["assistant"] : "";

      if (!model || !userMessage) {
        return ctx.json({ title: "New Chat" });
      }

      const prompt = `You label developer chat threads. Reply with ONE short title only: 3–8 words, Title Case, no quotes, no markdown, no trailing punctuation.

Focus on the user's goal: bug, feature, refactor, question, or error. Prefer concrete nouns and verbs from the user message. If the assistant only acknowledged, still name the topic from the user.

User message:
${userMessage.slice(0, 700)}

${assistantMessage.trim() ? `Assistant (for context, may be partial):\n${assistantMessage.slice(0, 500)}` : "Assistant reply not included yet — infer the topic from the user message only."}`;

      const inferenceKey = process.env["INFERENCE_API_KEY"] ?? "";
      const response = await fetchInference(context, "/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(inferenceKey ? { Authorization: `Bearer ${inferenceKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 36,
          temperature: 0.35,
        }),
      });

      if (response.status === 200) {
        const data = (await response.json()) as Record<string, unknown>;
        const choices = data["choices"] as Array<Record<string, unknown>> | undefined;
        const firstChoice = choices?.[0];
        const titleRaw =
          firstChoice && (firstChoice["message"] as Record<string, unknown>)?.["content"];
        let title = typeof titleRaw === "string" ? titleRaw.trim() : "";
        title = title.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        title = title.replace(/<\/?think(?:ing)?[^>]*>/gi, "").trim();
        title = title.replace(/^["']|["']$/g, "").trim();
        if (title.length > 60) {
          title = `${title.slice(0, 57)}...`;
        }
        return ctx.json({ title: title || "New Chat" });
      }

      return ctx.json({ title: "New Chat" });
    } catch (error) {
      context.logger.error("Title generation error", { error: String(error) });
      return ctx.json({ title: "New Chat" });
    }
  });
};
