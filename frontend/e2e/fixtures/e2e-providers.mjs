// Scripted provider registered into the agent runtime's provider hub when
// LOCAL_STUDIO_E2E_PROVIDERS points at this file. Exercises the REAL sign-in
// pipeline (login job -> auth_url -> browser approval -> credential persisted
// to auth.json -> Bearer on model requests) against fake-cloud.mjs.

const BASE = (process.env.LOCAL_STUDIO_E2E_FAKE_CLOUD || "http://127.0.0.1:43213").replace(
  /\/+$/,
  "",
);

async function requestToken(body) {
  const response = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Token request failed (${response.status})`);
  return response.json();
}

function credentialFromToken(tokenResponse) {
  return {
    refresh: tokenResponse.refresh_token,
    access: tokenResponse.access_token,
    expires: Date.now() + tokenResponse.expires_in * 1000,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const providers = {
  "e2e-cloud": {
    name: "E2E Cloud",
    baseUrl: `${BASE}/v1`,
    api: "openai-completions",
    authHeader: true,
    oauth: {
      name: "E2E Cloud account",
      async login(callbacks) {
        const state = Math.random().toString(36).slice(2);
        callbacks.onAuth({
          url: `${BASE}/authorize?state=${state}`,
          instructions: "Approve Local Studio in your browser.",
        });
        for (let attempt = 0; attempt < 480; attempt += 1) {
          if (callbacks.signal?.aborted) throw new Error("Login cancelled");
          const response = await fetch(`${BASE}/poll?state=${state}`);
          const status = await response.json();
          if (status.approved && status.code) {
            callbacks.onProgress?.("Exchanging authorization code…");
            return credentialFromToken(await requestToken({ code: status.code }));
          }
          await sleep(250);
        }
        throw new Error("Timed out waiting for browser approval");
      },
      async refreshToken(credentials) {
        return {
          ...credentials,
          ...credentialFromToken(await requestToken({ refresh_token: credentials.refresh })),
        };
      },
      getApiKey(credentials) {
        return credentials.access;
      },
    },
    models: [
      {
        id: "e2e-model",
        name: "E2E Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 4096,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStrictMode: false,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
        },
      },
    ],
  },
};

export default providers;
