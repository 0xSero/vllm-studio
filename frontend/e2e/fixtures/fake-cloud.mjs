// Hermetic stand-in for a cloud model provider: an OAuth authorization
// server (approval page + token endpoint) and an OpenAI-compatible /v1 API
// that rejects requests without a Bearer token it minted. Used by
// provider-hub.spec.ts through the scripted provider in e2e-providers.mjs.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 43213;

/** state -> { approved, code } */
const authRequests = new Map();
/** one-time authorization codes */
const codes = new Set();
/** refresh tokens -> true */
const refreshTokens = new Set();
/** live access tokens */
const accessTokens = new Set();

const REPLY_TEXT = "E2E cloud reply: provider OAuth path verified.";

function token(prefix) {
  return `${prefix}-${randomBytes(12).toString("hex")}`;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function mintTokens(res) {
  const access = token("e2e-access");
  const refresh = token("e2e-refresh");
  accessTokens.add(access);
  refreshTokens.add(refresh);
  json(res, 200, { access_token: access, refresh_token: refresh, expires_in: 3600 });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function approvalPage(state) {
  return `<!doctype html><html><body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
  <form method="POST" action="/approve?state=${encodeURIComponent(state)}" style="text-align:center;border:1px solid #333;padding:32px 40px">
    <h1 style="font-size:18px;margin:0 0 8px">E2E Cloud</h1>
    <p style="color:#999;margin:0 0 20px">Local Studio is requesting access to your E2E Cloud account.</p>
    <button type="submit" style="background:#4ade80;color:#111;border:0;padding:8px 24px;font-size:14px;cursor:pointer">Approve</button>
  </form></body></html>`;
}

function streamCompletion(req, res) {
  const auth = req.headers.authorization ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!accessTokens.has(bearer)) {
    json(res, 401, { error: { message: "Invalid or missing bearer token" } });
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const id = `chatcmpl-${Date.now()}`;
  const chunk = (delta, finish = null, usage) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "e2e-model",
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    })}\n\n`;
  res.write(chunk({ role: "assistant" }));
  const words = REPLY_TEXT.split(" ");
  let index = 0;
  const timer = setInterval(() => {
    if (index < words.length) {
      res.write(chunk({ content: (index === 0 ? "" : " ") + words[index] }));
      index += 1;
      return;
    }
    clearInterval(timer);
    res.write(chunk({}, "stop", { prompt_tokens: 12, completion_tokens: words.length, total_tokens: 12 + words.length }));
    res.write("data: [DONE]\n\n");
    res.end();
  }, 40);
  req.on("close", () => clearInterval(timer));
}

async function handleOAuth(req, res, url) {
  const state = url.searchParams.get("state") ?? "";
  if (url.pathname === "/authorize") {
    authRequests.set(state, { approved: false, code: null });
    return html(res, 200, approvalPage(state));
  }
  if (url.pathname === "/approve" && req.method === "POST") {
    const request = authRequests.get(state);
    if (!request) return html(res, 400, "<p>Unknown authorization request.</p>");
    const code = token("e2e-code");
    codes.add(code);
    authRequests.set(state, { approved: true, code });
    return html(
      res,
      200,
      `<body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh"><p>Approved — return to Local Studio.</p></body>`,
    );
  }
  if (url.pathname === "/poll") {
    const request = authRequests.get(state);
    return json(res, 200, { approved: Boolean(request?.approved), code: request?.code ?? null });
  }
  if (url.pathname === "/token" && req.method === "POST") {
    const body = await readBody(req);
    if (typeof body.code === "string" && codes.delete(body.code)) return mintTokens(res);
    if (typeof body.refresh_token === "string" && refreshTokens.has(body.refresh_token)) {
      return mintTokens(res);
    }
    return json(res, 400, { error: "invalid_grant" });
  }
  return false;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/health") return json(res, 200, { ok: true, service: "fake-cloud" });
  if ((await handleOAuth(req, res, url)) !== false) return;

  if (url.pathname === "/v1/models") {
    return json(res, 200, { object: "list", data: [{ id: "e2e-model", object: "model" }] });
  }
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    await readBody(req);
    return streamCompletion(req, res);
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[fake-cloud] listening on http://127.0.0.1:${PORT}`);
});
