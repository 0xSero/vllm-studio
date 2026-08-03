import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const MODELS_PAGE = "/configure?integration=models#integrations";

async function openModelsTab(page: Page): Promise<void> {
  await page.goto(MODELS_PAGE);
  await expect(page.getByRole("heading", { name: "Cloud models" })).toBeVisible({
    timeout: 20_000,
  });
}

function providerRow(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${name} logo ${name}\\b`) });
}

test("configure lists the provider catalog", async ({ page }) => {
  await openModelsTab(page);
  await expect(providerRow(page, "E2E Cloud")).toBeVisible();
  await expect(providerRow(page, "Anthropic")).toBeVisible();
  await expect(providerRow(page, "OpenAI Codex")).toBeVisible();
  await providerRow(page, "Anthropic").click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "API key", exact: true })).toBeVisible();
});

test("signs in to a provider with OAuth in the browser", async ({ page, context }) => {
  await openModelsTab(page);
  await providerRow(page, "E2E Cloud").click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

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
  await page.getByTestId("provider-login-panel").getByRole("button", { name: "Close" }).click();
  await expect(providerRow(page, "E2E Cloud")).toContainText("OAuth");
});

test("provider models join the picker and chat streams through the cloud", async ({ page }) => {
  await page.goto(`/agent?new=${encodeURIComponent("Provider hub chat")}`);
  await page.waitForLoadState("domcontentloaded");

  await test.step("Pick the cloud provider model", async () => {
    const modelPicker = page.getByRole("button", { name: /^Model:/ }).first();
    await expect(modelPicker).toBeEnabled({ timeout: 60_000 });
    await modelPicker.click();
    await page.getByRole("menuitem", { name: /^Model\b/ }).click();
    await page.getByRole("menuitemcheckbox", { name: /^Other models\b/ }).click();
    await page.getByRole("menuitemradio", { name: "e2e-model", exact: true }).click();
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
  await providerRow(page, "E2E Cloud").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(providerRow(page, "E2E Cloud")).toContainText("available", { timeout: 15_000 });
});

test("connects a builtin provider with an API key", async ({ page }) => {
  await openModelsTab(page);
  const row = providerRow(page, "Fireworks");
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.getByRole("button", { name: "API key", exact: true }).click();

  const prompt = page.getByTestId("provider-prompt-input");
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.fill("fw-e2e-fake-key");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByTestId("provider-login-success")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("provider-login-panel").getByRole("button", { name: "Close" }).click();
  await expect(providerRow(page, "Fireworks")).toContainText("API key");

  await test.step("Sign out again", async () => {
    await providerRow(page, "Fireworks").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(providerRow(page, "Fireworks")).toContainText("available", { timeout: 15_000 });
  });
});
