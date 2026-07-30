import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultOnboardingProfile } from "../src/agent-onboarding-service";
import { createAgentOnboardingHandlers } from "../src/http/agent-onboarding-handlers";

let dataDir = "";
const originalDesktop = process.env.LOCAL_STUDIO_DESKTOP;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "onboarding-handlers-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  delete process.env.LOCAL_STUDIO_DESKTOP;
});

afterEach(async () => {
  delete process.env.LOCAL_STUDIO_DATA_DIR;
  if (originalDesktop === undefined) delete process.env.LOCAL_STUDIO_DESKTOP;
  else process.env.LOCAL_STUDIO_DESKTOP = originalDesktop;
  await rm(dataDir, { recursive: true, force: true });
});

describe("agent onboarding runtime handlers", () => {
  test("requires the internal service credential", async () => {
    const handlers = createAgentOnboardingHandlers(() => "runtime-secret");
    const response = await handlers.get(
      new Request("http://127.0.0.1/api/agent/onboarding", {
        headers: { authorization: "Bearer browser-secret" },
      }),
    );
    expect(response.status).toBe(401);
  });

  test("returns only credential references and secure-store availability", async () => {
    const handlers = createAgentOnboardingHandlers(() => "runtime-secret");
    const response = await handlers.get(
      new Request("http://127.0.0.1/api/agent/onboarding", {
        headers: { authorization: "Bearer runtime-secret" },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"available":false');
    expect(body).toContain("vault:enterprise:vault");
    expect(body).not.toContain("runtime-secret");
  });

  test("fails closed instead of persisting credentials without a secure provider", async () => {
    const handlers = createAgentOnboardingHandlers(() => "runtime-secret");
    const secret = "credential-value-that-must-not-return";
    const response = await handlers.save(
      new Request("http://127.0.0.1/api/agent/onboarding", {
        method: "PUT",
        headers: {
          authorization: "Bearer runtime-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          profile: defaultOnboardingProfile(),
          credentials: [{ ref: "vault:enterprise:vault", value: secret }],
        }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret);
  });

  test("refuses apply when required secure credentials are unavailable", async () => {
    const handlers = createAgentOnboardingHandlers(() => "runtime-secret");
    const response = await handlers.apply(
      new Request("http://127.0.0.1/api/agent/onboarding/apply", {
        method: "POST",
        headers: { authorization: "Bearer runtime-secret" },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Secure credentials required");
  });

  test("does not disclose unexpected runtime error messages", async () => {
    const handlers = createAgentOnboardingHandlers(() => "runtime-secret");
    const response = await handlers.inference(
      new Request("http://127.0.0.1/api/agent/onboarding/inference/v1/models", {
        headers: { authorization: "Bearer runtime-secret" },
      }),
      ["v1", "models"],
    );
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).toContain("Inference proxy failed");
    expect(body).not.toContain(dataDir);
  });
});
