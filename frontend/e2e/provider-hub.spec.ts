import { expect, test, type Page } from "@playwright/test";

// Provider-hub user journey against the hermetic stack from
// provider-hub.config.ts: browse providers -> OAuth sign-in with a real
// browser approval roundtrip -> provider models join the picker -> a chat
// turn streams through the cloud provider with its Bearer token -> sign out
// -> API-key sign-in for a builtin provider. Serial: later tests build on
// the state earlier tests created. One video per flow.

test.describe.configure({ mode: "serial" });

const MODELS_PAGE = "/configure?integration=models#integrations";

async function openModelsTab(page: Page): Promise<void> {
  await page.goto(MODELS_PAGE);
  await expect(page.getByRole("heading", { name: "Connected providers" })).toBeVisible({
    timeout: 20_000,
  });
}

test("configure lists the provider catalog", async ({ page }) => {
  await openModelsTab(page);
  await expect(page.getByTestId("provider-add-e2e-cloud")).toBeVisible();
  await expect(page.getByTestId("provider-add-anthropic")).toBeVisible();
  await expect(page.getByTestId("provider-add-openai-codex")).toBeVisible();
  await expect(page.getByTestId("provider-add-anthropic").getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("provider-add-anthropic").getByRole("button", { name: "API key" })).toBeVisible();
});

test("signs in to a provider with OAuth in the browser", async ({ page, context }) => {
  await openModelsTab(page);
  await page.getByTestId("provider-add-e2e-cloud").getByRole("button", { name: "Sign in" }).click();

  const authLink = page.getByTestId("provider-auth-url");
  await expect(authLink).toBeVisible();
  const authUrl = await authLink.getAttribute("href");
  expect(authUrl).toBeTruthy();

  const approval = await context.newPage();
  await approval.goto(authUrl as string);
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(approval.getByText("Approved — return to Local Studio.")).toBeVisible();
  await approval.close();

  await expect(page.getByTestId("provider-login-success")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("provider-row-e2e-cloud")).toBeVisible();
  await expect(page.getByTestId("provider-row-e2e-cloud")).toContainText("OAuth");
});

test("provider models join the picker and chat streams through the cloud", async ({ page }) => {
  await page.goto(`/agent?new=${encodeURIComponent("Provider hub chat")}`);
  await page.waitForLoadState("domcontentloaded");

  await test.step("Pick the cloud provider model", async () => {
    const modelPicker = page.getByRole("button", { name: /^Model:/ }).first();
    await expect(modelPicker).toBeEnabled({ timeout: 60_000 });
    await modelPicker.click();
    await page.getByRole("menuitem", { name: /^Model\b/ }).click();
    const group = page.getByRole("menuitem", { name: /^E2E Cloud\b/ });
    await group.click();
    await page.getByText("e2e-model", { exact: true }).last().click();
    // Trigger aria-label carries the display name; visible text is the raw id.
    await expect(page.getByRole("button", { name: /^Model: E2E Model/ })).toBeVisible();
  });

  await test.step("Stream a reply through the provider", async () => {
    const composer = page.getByPlaceholder(/Do anything|Ask for follow-up changes/).first();
    await composer.fill("Say hello through the fake cloud.");
    await composer.press("Enter");
    await expect(page.getByText("E2E cloud reply: provider OAuth path verified.")).toBeVisible({
      timeout: 60_000,
    });
  });
});

test("signs out of the OAuth provider", async ({ page }) => {
  await openModelsTab(page);
  await expect(page.getByTestId("provider-row-e2e-cloud")).toBeVisible();
  await page.getByTestId("provider-row-e2e-cloud").getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("provider-row-e2e-cloud")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("provider-add-e2e-cloud")).toBeVisible();
});

test("connects a builtin provider with an API key", async ({ page }) => {
  await openModelsTab(page);
  const row = page.getByTestId("provider-add-fireworks");
  await row.scrollIntoViewIfNeeded();
  await row.getByRole("button", { name: "API key" }).click();

  const prompt = page.getByTestId("provider-prompt-input");
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.fill("fw-e2e-fake-key");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByTestId("provider-login-success")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("provider-row-fireworks")).toBeVisible();
  await expect(page.getByTestId("provider-row-fireworks")).toContainText("API key");

  await test.step("Sign out again", async () => {
    await page.getByTestId("provider-row-fireworks").getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("provider-row-fireworks")).toHaveCount(0, { timeout: 15_000 });
  });
});
