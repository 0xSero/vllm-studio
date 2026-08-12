import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type RuntimeMetadata = {
  piAgentDir: string;
  piRuntime: {
    program: string;
    args: string[];
    env: Record<string, string>;
  };
};

async function runtimeMetadata(testInfo: TestInfo): Promise<RuntimeMetadata> {
  const dataDir = testInfo.config.metadata.localStudioDataDir;
  if (typeof dataDir !== "string") {
    throw new Error("Litter runtime metadata directory is unavailable");
  }
  const filepath = path.join(dataDir, "litter-bridge.json");
  await expect.poll(() => existsSync(filepath)).toBe(true);
  return JSON.parse(readFileSync(filepath, "utf8")) as RuntimeMetadata;
}

function publishedSessionFile(piAgentDir: string, sessionId: string): string | null {
  const sessionsDir = path.join(piAgentDir, "sessions");
  if (!existsSync(sessionsDir)) return null;
  const entry = readdirSync(sessionsDir, { recursive: true }).find((candidate) =>
    String(candidate).includes(sessionId),
  );
  return entry ? path.join(sessionsDir, String(entry)) : null;
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

test("the runtime target registry drives recorded controller status", async ({
  page,
}, testInfo) => {
  const port = testInfo.config.metadata.recordedControllerPort;
  if (typeof port !== "number") throw new Error("Recorded controller port is unavailable");
  const origin = `http://127.0.0.1:${port}`;

  await page.goto(`${origin}/runtime/targets`);
  const targets = JSON.parse(await page.locator("body").innerText()) as {
    targets: Array<{ backend: string; version: string | null; installed: boolean }>;
  };
  const versions = Object.fromEntries(
    targets.targets.map((target) => [target.backend, target.version]),
  );
  expect(versions).toMatchObject({
    vllm: "0.9.1",
    sglang: "0.4.2",
    llamacpp: "4321 (recorded)",
    mlx: "0.26.0",
  });

  await page.goto(`${origin}/config`);
  const config = JSON.parse(await page.locator("body").innerText()) as {
    runtime: { backends: Record<string, { installed: boolean; version: string | null }> };
  };
  for (const [backend, version] of Object.entries(versions)) {
    expect(config.runtime.backends[backend]).toMatchObject({ installed: true, version });
  }
});

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

test("model card renders recorded safe HTML without executing active content", async ({ page }) => {
  await page.route(/\/api\/huggingface\/models(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          _id: "recorded/safe-html-model",
          modelId: "recorded/safe-html-model",
          author: "recorded",
          downloads: 12_000,
          likes: 800,
          tags: ["safetensors"],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          private: false,
        },
      ]),
    }),
  );
  await page.route(/\/api\/huggingface\/model-card(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        modelId: "recorded/safe-html-model",
        author: "recorded",
        downloads: 12_000,
        likes: 800,
        tags: ["safetensors"],
        readme:
          "<h2>Safe HTML heading</h2><p>Rendered <strong>content</strong>.</p><script>globalThis.modelCardInjected=true</script>",
      }),
    }),
  );

  await page.goto("/models?tab=get");
  const model = page.getByText("recorded/safe-html-model", { exact: true });
  await expect(model).toBeVisible();
  await model.click();
  await expect(page.getByRole("heading", { name: "Safe HTML heading" })).toBeVisible();
  await expect(page.getByText("Rendered content.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, "modelCardInjected"))).toBeUndefined();
});

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

test("fork opens a copied session in a second pane and closing it preserves the source", async ({
  page,
}) => {
  const composer = await openControllerChat(page, "Forked pane parity");
  const opening = "Keep this transcript visible in both recorded panes.";
  await composer.fill(opening);
  await composer.press("Enter");
  await expect(page.getByText("Controller scoped Pi reply.")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Session settings" }).click();
  await page.getByRole("menuitem", { name: "Fork" }).click();

  await expect(page.locator("[data-multi-pane=true]")).toBeVisible();
  const panes = page.locator("[data-pane-id]");
  await expect(panes).toHaveCount(2);
  await expect(page.getByPlaceholder(/Do anything|Ask for follow-up changes/)).toHaveCount(2);
  await expect(panes.getByText(opening, { exact: true })).toHaveCount(2);
  await expect(panes.getByText("Controller scoped Pi reply.", { exact: true })).toHaveCount(2);

  await panes.last().getByRole("button", { name: "Close pane" }).click();
  await expect(page.locator("[data-multi-pane=true]")).toHaveCount(0);
  await expect(page.locator("[data-pane-id]")).toHaveCount(1);
  await expect(panes.getByText(opening, { exact: true })).toBeVisible();
  await expect(panes.getByText("Controller scoped Pi reply.", { exact: true })).toBeVisible();
});

test("a background session reports completion and reopens without losing its transcript", async ({
  page,
}) => {
  const composer = await openControllerChat(page, "Background completion parity");
  const opening = "slow-response-marker background completion";
  await composer.fill(opening);
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

  await page.getByRole("link", { name: "New task" }).click();
  await expect(page.locator("[data-multi-pane=true]")).toHaveCount(0);
  await expect(page.getByLabel("Session running")).toBeVisible();
  await expect(page.getByLabel("Run finished")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: opening }).click();
  const transcript = page.getByRole("article");
  await expect(transcript.getByText(opening, { exact: true })).toBeVisible();
  await expect(transcript.getByText("Slow response complete.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Run finished")).toHaveCount(0);
});

test("Litter runtime metadata publishes the recorded Pi session store", async ({
  page,
}, testInfo) => {
  const composer = await openControllerChat(page, "Litter runtime parity");
  const opening = "Keep this conversation in the published Local Studio session store.";
  await composer.fill(opening);
  await composer.press("Enter");
  await expect(page.getByText("Controller scoped Pi reply.")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).not.toBeNull();
  const sessionId = new URL(page.url()).searchParams.get("session");
  if (!sessionId) throw new Error("Recorded Pi session id is unavailable");

  const metadata = await runtimeMetadata(testInfo);
  const dataDir = testInfo.config.metadata.localStudioDataDir;
  expect(metadata.piAgentDir).toBe(path.join(String(dataDir), "pi-agent"));
  const version = execFileSync(
    metadata.piRuntime.program,
    [...metadata.piRuntime.args, "--version"],
    {
      encoding: "utf8",
      env: { ...process.env, ...metadata.piRuntime.env },
    },
  ).trim();
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
  await expect.poll(() => Boolean(publishedSessionFile(metadata.piAgentDir, sessionId))).toBe(true);

  const followUp = "Continue the same published Local Studio session.";
  await composer.fill(followUp);
  await composer.press("Enter");
  await expect(page.getByText(followUp, { exact: true })).toBeVisible();
  await expect(page.getByText("Controller scoped Pi reply.", { exact: true })).toHaveCount(2, {
    timeout: 60_000,
  });

  const sessionFile = publishedSessionFile(metadata.piAgentDir, sessionId);
  if (!sessionFile) throw new Error("Published Pi session file is unavailable");
  const runtimeEnv = {
    ...process.env,
    ...metadata.piRuntime.env,
    PI_CODING_AGENT_DIR: metadata.piAgentDir,
  };
  const externalFollowUp = "Continue this session through the published Pi runtime.";
  const runtimeOutput = execFileSync(
    metadata.piRuntime.program,
    [
      ...metadata.piRuntime.args,
      "--mode",
      "json",
      "--session",
      sessionFile,
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      externalFollowUp,
    ],
    {
      encoding: "utf8",
      env: runtimeEnv,
    },
  );
  expect(runtimeOutput).toContain("Controller scoped Pi reply.");
  const rpcOutput = execFileSync(
    metadata.piRuntime.program,
    [
      ...metadata.piRuntime.args,
      "--mode",
      "rpc",
      "--session",
      sessionFile,
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
    ],
    {
      encoding: "utf8",
      env: runtimeEnv,
      input: `${JSON.stringify({ type: "get_entries" })}\n`,
    },
  );
  const rpcSession = JSON.parse(rpcOutput.trim()) as { success: boolean; data: unknown };
  expect(rpcSession.success).toBe(true);
  const publishedTranscript = JSON.stringify(rpcSession.data);
  expect(publishedTranscript).toContain(opening);
  expect(publishedTranscript).toContain(followUp);
  expect(publishedTranscript).toContain(externalFollowUp);

  await page.goto(`/agent?session=${encodeURIComponent(sessionId)}`);
  const transcript = page.getByRole("article");
  await expect(transcript.getByText(opening, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(transcript.getByText(followUp, { exact: true })).toBeVisible();
  await expect(transcript.getByText(externalFollowUp, { exact: true })).toBeVisible();
  await expect(transcript.getByText("Controller scoped Pi reply.", { exact: true })).toHaveCount(3);
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

test("the focused session restores its recorded workbench resource", async ({ page }) => {
  const composer = await openControllerChat(page, "Persistent workbench resource");
  await composer.fill("Create a durable workbench session");
  await composer.press("Enter");
  await expect(page.getByText("Controller scoped Pi reply.")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Show right sidebar" }).click();
  await page.getByRole("button", { name: "Show tools" }).click();
  await page.getByRole("button", { name: /Files Browse project files/ }).click();
  await expect(page.getByText("Select a file to view.")).toBeVisible();

  await page.reload();

  await expect(page.getByText("Select a file to view.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTitle("Files", { exact: true })).toBeVisible();
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

test("stopping an active turn preserves the authoritative transcript", async ({ page }) => {
  const composer = await openControllerChat(page, "Runtime stop chat");
  const transcript = page.getByRole("article");
  await composer.fill("slow-response-marker");
  await composer.press("Enter");
  await expect(transcript.getByText("slow-response-marker", { exact: true })).toBeVisible();
  const stop = page.getByRole("button", { name: "Stop" });
  await expect(stop).toBeEnabled({ timeout: 60_000 });

  await stop.click();

  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 60_000 });
  await expect(transcript.getByText("slow-response-marker", { exact: true })).toHaveCount(1);
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
  await page.getByLabel("Context Length").fill("16384");

  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await expect(page.getByText("Parallelism", { exact: true })).toBeVisible();
  await expect(page.getByText("GPU", { exact: true })).toBeVisible();
  await page.getByLabel("Tensor Parallel").fill("2");
  await page.getByLabel("Visible Devices").fill("0,1");

  await page.getByRole("button", { name: "Performance", exact: true }).click();
  await expect(page.getByText("CUDA Graphs & Compilation", { exact: true })).toBeVisible();
  await expect(page.getByText("KV Cache & Memory", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Prefix Caching" }).check();

  await page.getByRole("button", { name: "Features", exact: true }).click();
  await expect(page.getByText("Model Input", { exact: true })).toBeVisible();
  await expect(page.getByText("Tool Calling", { exact: true })).toBeVisible();
  await page.getByLabel("Tool Call Parser").selectOption("hermes");
  await page.getByRole("checkbox", { name: "Enable Thinking Mode" }).check();
  await page.getByLabel("Thinking Budget (tokens)").fill("2048");

  await page.getByRole("tab", { name: "SGLang", exact: true }).click();
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await expect(page.getByText("Parallelism", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Maps to SGLang --mem-fraction-static.", { exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "llama.cpp", exact: true }).click();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByText("llama.cpp Model Options", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await expect(page.getByText("llama.cpp Resource Options", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "MLX", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resources", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Features", exact: true }).click();
  await expect(page.getByText("MLX Sampling & Features", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "vLLM", exact: true }).click();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByLabel("Context Length")).toHaveValue("16384");
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await expect(page.getByLabel("Tensor Parallel")).toHaveValue("2");
  await expect(page.getByLabel("Visible Devices")).toHaveValue("0,1");
  await page.getByRole("button", { name: "Performance", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Prefix Caching" })).toBeChecked();
  await page.getByRole("button", { name: "Features", exact: true }).click();
  await expect(page.getByLabel("Tool Call Parser")).toHaveValue("hermes");
  await expect(page.getByRole("checkbox", { name: "Enable Thinking Mode" })).toBeChecked();
  await expect(page.getByLabel("Thinking Budget (tokens)")).toHaveValue("2048");
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

test("integration resources preserve plugin and skill details", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/configure?section=integrations&integration=plugins#integrations");
  const plugin = page.locator('[role="button"]').filter({ hasText: "Chatterbox Voice" }).first();
  await expect(plugin).toBeVisible({ timeout: 20_000 });
  await plugin.click();
  const pluginDialog = page.getByRole("dialog");
  await expect(pluginDialog.getByText("Identity", { exact: true })).toBeVisible();
  await expect(pluginDialog.getByText("Capabilities", { exact: true })).toBeVisible();
  await expect(pluginDialog.getByText("chatterbox-voice", { exact: true })).toBeVisible();

  await page.goto("/configure?section=integrations&integration=skills#integrations");
  const skill = page.locator('[role="button"]').filter({ hasText: "recorded-resource" }).first();
  await expect(skill).toBeVisible({ timeout: 20_000 });
  await skill.click();
  const skillDialog = page.getByRole("dialog");
  await expect(skillDialog.getByText("recorded resource", { exact: true })).toBeVisible();
  await expect(skillDialog.locator("pre")).toContainText(
    "This instruction proves the discovered skill detail flow.",
  );
  const copy = skillDialog.getByRole("button", { name: "Copy path" });
  await copy.click();
  await expect(skillDialog.getByRole("button", { name: "Copied" })).toBeVisible();
});
