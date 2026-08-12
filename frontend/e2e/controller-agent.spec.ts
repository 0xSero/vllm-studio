import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

type JsonValue = null | boolean | string | number | JsonValue[] | { [key: string]: JsonValue };
type BridgeMetadata = {
  url: string;
  secretHeader: string;
  secret: string;
  controllerId: string;
};
type BridgeCursor = {
  type: "session_transfer_cursor";
  token: string;
  revision: number;
  afterSequence: number;
  hasMore: boolean;
};
type BridgeSessionPage = {
  type: "session_page";
  messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>;
  cursor: BridgeCursor | null;
};

const bridgeKeys = generateKeyPairSync("ed25519");
const bridgeDeviceId = (bridgeKeys.publicKey.export({ format: "der", type: "spki" }) as Buffer)
  .subarray(-32)
  .toString("hex");

function canonicalJson(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function bridgeSignaturePreimage(fields: string[]): Buffer {
  const parts = [Buffer.from("litter-bridge-request-v1", "ascii")];
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
}

function signedBridgeRequest(
  body: { [key: string]: JsonValue },
  capability: "sessions.read",
  privateKey: KeyObject = bridgeKeys.privateKey,
): { [key: string]: JsonValue } {
  const requestId = randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 30_000);
  const nonce = randomBytes(16).toString("base64url");
  const bodyHash = createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
  const auth = {
    device: { deviceId: bridgeDeviceId, keyId: bridgeDeviceId, algorithm: "ed25519" },
    requestId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce,
    capability,
    bodyHash,
    signature: "",
  };
  auth.signature = sign(
    null,
    bridgeSignaturePreimage([
      bridgeDeviceId,
      bridgeDeviceId,
      requestId,
      auth.issuedAt,
      auth.expiresAt,
      nonce,
      capability,
      "",
      bodyHash,
    ]),
    privateKey,
  ).toString("base64url");
  return { ...body, auth };
}

async function bridgeMetadata(testInfo: TestInfo): Promise<BridgeMetadata> {
  const dataDir = testInfo.config.metadata.localStudioDataDir;
  if (typeof dataDir !== "string") {
    throw new Error("Litter bridge test data directory is unavailable");
  }
  const filepath = path.join(dataDir, "litter-bridge.json");
  await expect.poll(() => existsSync(filepath)).toBe(true);
  return JSON.parse(readFileSync(filepath, "utf8")) as BridgeMetadata;
}

async function postBridge(
  request: APIRequestContext,
  metadata: BridgeMetadata,
  body: { [key: string]: JsonValue },
): Promise<unknown> {
  const response = await request.post(metadata.url, {
    headers: { [metadata.secretHeader]: metadata.secret },
    data: signedBridgeRequest(body, "sessions.read"),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function openControllerChat(page: Page, title: string) {
  await page.goto(`/agent?new=${encodeURIComponent(title)}`);
  await expect(page.getByRole("button", { name: /^Model:/ }).first()).toBeEnabled({
    timeout: 60_000,
  });
  return page.getByPlaceholder(/Do anything|Ask for follow-up changes/).first();
}

for (const route of [
  "/",
  "/agent",
  "/agent/automations",
  "/configure",
  "/logs",
  "/quick",
  "/settings",
  "/setup",
  "/usage",
]) {
  test(`${route} renders without a browser error`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route);
    expect(response?.ok()).toBeTruthy();
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
    if (route === "/setup") {
      await expect(page.getByRole("textbox", { name: "Where model weights live" })).toHaveValue(
        "/models",
      );
      await expect(page.getByText(/controller is unreachable/i)).toHaveCount(0);
    }
  });
}

for (const [route, destination] of [
  ["/discover", "/models"],
  ["/integrations", "/configure?section=integrations#integrations"],
  ["/recipes", "/models"],
  ["/server", "/configure?section=server#server"],
] as const) {
  test(`${route} redirects to ${destination}`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok()).toBeTruthy();
    expect(
      new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash,
    ).toBe(destination);
  });
}

test("appearance mode resolves the shared semantic palette", async ({ page }) => {
  const terminalRed = () =>
    page.evaluate(() => {
      const swatch = document.createElement("span");
      swatch.style.color = "var(--color-terminal-red)";
      document.body.appendChild(swatch);
      const color = getComputedStyle(swatch).color;
      swatch.remove();
      return color;
    });

  await page.goto("/settings#appearance");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "zai-dark");
  expect(await terminalRed()).toBe("rgb(246, 117, 118)");

  await page.getByRole("tab", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "zai-light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await terminalRed()).toBe("rgb(224, 46, 42)");

  await page.getByRole("tab", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "zai-dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(24, 24, 24)");
  expect(await terminalRed()).toBe("rgb(246, 117, 118)");
});

test("shortcut settings share keyboard capture and keycap rendering", async ({ page }) => {
  await page.addInitScript(() => {
    let hotkey = "CommandOrControl+Shift+Space";
    Reflect.set(window, "localStudioDesktop", {
      quickPanel: {
        getHotkey: async () => ({ hotkey, defaultHotkey: "CommandOrControl+Shift+Space" }),
        setHotkey: async (next: string) => {
          hotkey = next;
          Reflect.set(window, "recordedQuickPanelHotkey", next);
          return { ok: true, hotkey };
        },
      },
    });
  });
  await page.goto("/settings#terminal");

  const quickPanelRow = page.getByText("Global hotkey", { exact: true }).locator("xpath=../../..");
  await expect(quickPanelRow.locator("kbd")).toHaveText([/Ctrl|⌘/, /Shift|⇧/, "Space"]);
  await quickPanelRow.getByRole("button", { name: "Change" }).click();
  await page.keyboard.press("Control+Alt+P");
  await expect(quickPanelRow.locator("kbd")).toHaveText([/Ctrl|⌃/, /Alt|⌥/, "P"]);
  expect(await page.evaluate(() => Reflect.get(window, "recordedQuickPanelHotkey"))).toBe(
    "Control+Alt+P",
  );

  const terminalRow = page.getByText("Clear terminal", { exact: true }).locator("xpath=../../..");
  await terminalRow.getByRole("button", { name: "Rebind" }).click();
  await page.keyboard.press("Control+Shift+L");
  await expect(terminalRow.locator("kbd")).toHaveText([/Ctrl|⌃/, /Shift|⇧/, "L"]);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("local-studio.terminalKeybinds.v1") ?? "{}"),
  );
  expect(saved.clearTerminal).toMatch(/^(mod|ctrl)\+shift\+l$/);
});

test("Pi defaults to the active controller and reveals other models on request", async ({
  page,
}) => {
  await page.goto(`/agent?new=${encodeURIComponent("Controller scoped chat")}`);
  const picker = page.getByRole("button", { name: /^Model:/ }).first();
  await expect(picker).toBeEnabled({ timeout: 60_000 });
  await expect(picker).toHaveAccessibleName(/controller-model/);
  await expect(page.getByRole("button", { name: "Browser tools" })).toBeVisible();
  await picker.click();
  await page.getByRole("menuitem", { name: /^Model\b/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "controller-model" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "other-model" })).toHaveCount(0);
  await page.getByRole("menuitemcheckbox", { name: /Other models/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "other-model" })).toBeVisible();
  await page.keyboard.press("Escape");

  const composer = page.getByPlaceholder(/Do anything|Ask for follow-up changes/).first();
  await composer.fill("Reply from this controller.");
  await composer.press("Enter");
  await expect(page.getByText("Controller scoped Pi reply.")).toBeVisible({ timeout: 60_000 });
});

test("new task replaces the current chat with a fresh session", async ({ page }) => {
  const composer = await openControllerChat(page, "Replace current chat");
  const opening = "Keep this chat out of the new session.";
  await composer.fill(opening);
  await composer.press("Enter");
  await expect(page.getByText("Controller scoped Pi reply.")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "New task" }).click();

  await expect(page.getByPlaceholder(/Do anything|Ask for follow-up changes/)).toHaveCount(1);
  await expect(page.locator("[data-multi-pane=true]")).toHaveCount(0);
  await expect(page.getByText("Controller scoped Pi reply.")).toHaveCount(0);

  await page.getByRole("link", { name: opening }).click();
  const transcript = page.getByRole("article");
  await expect(transcript.getByText(opening, { exact: true })).toBeVisible();
  await expect(transcript.getByText("Controller scoped Pi reply.")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator("[data-multi-pane=true]")).toHaveCount(0);
});

test("signed Litter bridge discovers and pages the recorded session", async ({
  page,
  request,
}, testInfo) => {
  const composer = await openControllerChat(page, "Litter bridge parity");
  const opening = "Export this conversation through the signed bridge.";
  await composer.fill(opening);
  await composer.press("Enter");
  await expect(page.getByText("Controller scoped Pi reply.")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).not.toBeNull();
  const sessionId = new URL(page.url()).searchParams.get("session");
  if (!sessionId) throw new Error("Recorded Pi session id is unavailable");

  const metadata = await bridgeMetadata(testInfo);
  const listed = (await postBridge(request, metadata, {
    type: "session_list_request",
    protocolVersion: 1,
    cursor: null,
    limit: 200,
  })) as {
    type: string;
    sessions: Array<{ session: { sessionId: string }; metadata: { title: string | null } }>;
  };
  expect(listed.type).toBe("session_list_page");
  expect(listed.sessions).toContainEqual(
    expect.objectContaining({ session: expect.objectContaining({ sessionId }) }),
  );

  const identity = {
    kind: "external_session",
    authority: "local-studio",
    installationId: metadata.controllerId,
    sessionId,
  };
  const messages: BridgeSessionPage["messages"] = [];
  let cursor: BridgeCursor | null = null;
  do {
    const result = (await postBridge(request, metadata, {
      type: "session_read_request",
      protocolVersion: 1,
      session: cursor ? null : identity,
      cursor,
      limit: 1,
    })) as BridgeSessionPage;
    expect(result.type).toBe("session_page");
    messages.push(...result.messages);
    cursor = result.cursor;
  } while (cursor);

  const text = messages.flatMap((message) =>
    message.parts.filter((part) => part.type === "text").map((part) => part.text),
  );
  expect(text).toContain(opening);
  expect(text).toContain("Controller scoped Pi reply.");
});

test("live runtime results drive subagents, automations, and goals", async ({ page, request }) => {
  const composer = await openControllerChat(page, "Runtime result authority");
  await composer.fill("Create the parent runtime session.");
  await composer.press("Enter");
  await expect(page.getByText("Controller scoped Pi reply.")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).not.toBeNull();
  const piSessionId = new URL(page.url()).searchParams.get("session");
  if (!piSessionId) throw new Error("Recorded Pi session id is unavailable");

  const subagentResponse = await request.post("/api/agent/subagents", {
    data: {
      parentPiSessionId: piSessionId,
      name: "Recorded worker",
      task: "Return the recorded controller response.",
    },
  });
  expect(subagentResponse.ok(), await subagentResponse.text()).toBe(true);
  const subagent = (await subagentResponse.json()) as {
    result: string;
    piSessionId: string | null;
  };
  expect(subagent.result).toBe("Controller scoped Pi reply.");
  expect(subagent.piSessionId).not.toBeNull();
  const subagents = await request.get(
    `/api/agent/subagents?piSessionId=${encodeURIComponent(piSessionId)}`,
  );
  expect(subagents.ok(), await subagents.text()).toBe(true);
  expect((await subagents.json()).subagents).toContainEqual(
    expect.objectContaining({ name: "Recorded worker", status: "done" }),
  );

  const createResponse = await request.post("/api/agent/automations", {
    data: {
      name: "Recorded runtime result",
      prompt: "Return the recorded controller response.",
      modelId: "controller-model",
      cwd: "",
      schedule: { kind: "daily", time: "08:00" },
    },
  });
  expect(createResponse.ok(), await createResponse.text()).toBe(true);
  const created = (await createResponse.json()) as { automation: { id: string } };
  const automationId = created.automation.id;
  const runResponse = await request.post(
    `/api/agent/automations/${encodeURIComponent(automationId)}/run`,
  );
  expect(runResponse.ok(), await runResponse.text()).toBe(true);
  expect(await runResponse.json()).toEqual({ ok: true, started: true });
  const automationsResponse = await request.get("/api/agent/automations");
  expect(automationsResponse.ok(), await automationsResponse.text()).toBe(true);
  const automations = (await automationsResponse.json()) as {
    automations: Array<{
      id: string;
      lastRun: { outcome: string; summary: string; piSessionId: string | null } | null;
    }>;
  };
  expect(automations.automations.find(({ id }) => id === automationId)?.lastRun).toEqual(
    expect.objectContaining({
      outcome: "ok",
      summary: "Controller scoped Pi reply.",
      piSessionId: expect.any(String),
    }),
  );
  const deleteResponse = await request.delete(
    `/api/agent/automations/${encodeURIComponent(automationId)}`,
  );
  expect(deleteResponse.ok(), await deleteResponse.text()).toBe(true);

  const goalResponse = await request.put(
    `/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`,
    { data: { objective: "Finish the recorded goal", status: "active" } },
  );
  expect(goalResponse.ok(), await goalResponse.text()).toBe(true);
  await composer.fill("goal-complete-marker");
  await composer.press("Enter");
  await expect(page.getByText("Recorded goal work finished. GOAL_COMPLETE")).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(async () => {
      const response = await request.get(
        `/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`,
      );
      if (!response.ok()) return null;
      const payload = (await response.json()) as { goal: { status?: string } | null };
      return payload.goal?.status ?? null;
    })
    .toBe("complete");
});

test("model picker includes models from every saved controller", async ({ page }) => {
  await page.addInitScript(() => {
    const primaryUrl = "http://127.0.0.1:43222";
    localStorage.setItem("localstudio_backend_url", primaryUrl);
    localStorage.setItem(
      "local-studio.controllers",
      JSON.stringify([
        { name: "Primary", url: primaryUrl },
        { name: "Secondary", url: "http://127.0.0.1:43223" },
      ]),
    );
  });
  await page.goto(`/agent?new=${encodeURIComponent("All controller models")}`);
  const picker = page.getByRole("button", { name: /^Model:/ }).first();
  await expect(picker).toBeEnabled({ timeout: 60_000 });
  await picker.click();
  await page.getByRole("menuitem", { name: /^Model\b/ }).click();

  await expect(page.getByRole("menuitemradio", { name: /controller-model/ })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /secondary-model/ })).toBeVisible();
});

test("terminal preserves its shell and scrollback across chat navigation", async ({ page }) => {
  await openControllerChat(page, "Persistent terminal");
  await page.getByRole("button", { name: "Open terminal" }).click();

  const terminal = page.locator(".xterm").first();
  const input = terminal.locator(".xterm-helper-textarea");
  await expect(input).toBeAttached({ timeout: 60_000 });
  await input.pressSequentially("printf 'terminal-parity-marker\\n'", { delay: 15 });
  await input.press("Enter");
  await expect(terminal).toContainText("terminal-parity-marker", { timeout: 60_000 });

  await page.getByRole("button", { name: "Back to chat" }).click();
  await page.getByRole("button", { name: "Open terminal" }).click();
  await expect(terminal).toContainText("terminal-parity-marker");
});

test("messages containing /goal reach Pi as ordinary text", async ({ page }) => {
  const composer = await openControllerChat(page, "Goal text chat");
  const transcript = page.getByRole("article");
  const opening = "/goal is ordinary text before the Pi session exists";
  await composer.fill(opening);
  await composer.press("Enter");
  await expect(transcript.getByText(opening, { exact: true })).toBeVisible();
  await expect(transcript.getByText("Controller scoped Pi reply.")).toBeVisible({
    timeout: 60_000,
  });

  const embedded = "Please explain what /goal means without running it";
  await composer.fill(embedded);
  await composer.press("Enter");
  await expect(transcript.getByText(embedded, { exact: true })).toBeVisible();
  await expect(transcript.getByText("Controller scoped Pi reply.")).toHaveCount(2, {
    timeout: 60_000,
  });
});

test("Enter queues while the explicit control steers the active Pi turn", async ({ page }) => {
  const composer = await openControllerChat(page, "Queue and steer chat");
  await composer.fill("slow-response-marker");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled({ timeout: 60_000 });

  await composer.fill("queue-after-marker");
  await composer.press("Enter");
  const queue = page.getByTestId("queued-message-stack");
  await expect(queue.getByText("queue-after-marker", { exact: true })).toBeVisible();

  await composer.fill("interrupt-now-marker");
  await page.getByRole("button", { name: "Steer current task now" }).click();
  await expect(page.getByText("interrupt-now-marker", { exact: true })).toBeVisible();
  await expect(page.getByText("Steered response acknowledged.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Queued response acknowledged.")).toBeVisible({ timeout: 60_000 });
  await expect(queue).toHaveCount(0);
});

test("Alt+Enter steers instead of queueing", async ({ page }) => {
  const composer = await openControllerChat(page, "Keyboard steer chat");
  await composer.fill("slow-response-marker");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled({ timeout: 60_000 });

  await composer.fill("interrupt-now-marker");
  await composer.press("Alt+Enter");
  await expect(page.getByText("interrupt-now-marker", { exact: true })).toBeVisible();
  await expect(page.getByText("Steered response acknowledged.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("queued-message-stack")).toHaveCount(0);
});

test("active runtime reconnects without duplicating the transcript", async ({ page }) => {
  const composer = await openControllerChat(page, "Runtime reconnect chat");
  await composer.fill("slow-response-marker");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled({ timeout: 60_000 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("local-studio.agent.paneState");
        if (!raw) return false;
        const sessions = JSON.parse(raw).sessions;
        return Array.isArray(sessions) && sessions.some((session) => Boolean(session.piSessionId));
      }),
    )
    .toBe(true);

  await page.reload();

  const transcript = page.getByRole("article");
  await expect(transcript.getByText("slow-response-marker", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
  await expect(transcript.getByText("Slow response complete.", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(transcript.getByText("slow-response-marker", { exact: true })).toHaveCount(1);
  await expect(transcript.getByText("Slow response complete.", { exact: true })).toHaveCount(1);
});

test("mobile navigation and composer remain usable at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agent");
  const menu = page.getByRole("button", { name: "Open navigation menu" });
  await menu.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByPlaceholder(/Do anything|Ask for follow-up changes/).first(),
  ).toBeVisible();
});

test("pairing JSON is copyable from laptop and phone web layouts", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/settings#profile");
  const copy = page.getByRole("button", { name: "Copy KittyLitter connection JSON" });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(copy).toContainText("Copied");
  const desktopValue = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(desktopValue)).toEqual({
    v: 1,
    node_id: "test-node",
    token: "test-token",
    host_name: "test-host",
    relay: null,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(copy).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(desktopValue);
});

test("serve editor preserves every capability tab", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/configure?section=models&tab=serves&new=1#models");
  await expect(page.getByText("New Serve", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByText("Model & Context", { exact: true })).toBeVisible();
  await expect(page.getByText("Weights & Quantization", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await expect(page.getByText("Parallelism", { exact: true })).toBeVisible();
  await expect(page.getByText("GPU", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Performance", exact: true }).click();
  await expect(page.getByText("CUDA Graphs & Compilation", { exact: true })).toBeVisible();
  await expect(page.getByText("KV Cache & Memory", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Features", exact: true }).click();
  await expect(page.getByText("Model Input", { exact: true })).toBeVisible();
  await expect(page.getByText("Tool Calling", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("voice plugin validates the controller speech contract", async ({ page }) => {
  await page.goto("/configure?section=integrations&integration=plugins#integrations");
  const plugin = page.locator('[role="button"]').filter({ hasText: "Chatterbox Voice" }).first();
  await expect(plugin).toBeVisible({ timeout: 20_000 });
  await plugin.click();
  await page.getByRole("dialog").getByRole("button", { name: "Manage Chatterbox Voice" }).click();
  await expect(page.getByText("Chatterbox Turbo", { exact: true })).toBeVisible();
  await expect(page.getByText("Recorded parity voice", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Test RTX 3090", { exact: true })).toBeVisible();
});
