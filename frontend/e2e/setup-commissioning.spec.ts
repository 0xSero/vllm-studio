import { expect, test, type Page } from "@playwright/test";

const tracks = [
  ["Access", "Establish enterprise identity"],
  ["Credentials", "Enroll services and agents"],
  ["Environment", "Connect the execution environment"],
  ["Inference", "Commission model serving"],
  ["Review", "Review the commissioned boundary"],
] as const;

const observeFailures = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
};

const expectNoHorizontalOverflow = async (page: Page) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
};

test("commissioning exposes every governed track with C2 authority", async ({ page }, testInfo) => {
  const errors = observeFailures(page);
  await page.goto("/setup");
  await expect(page.locator("html")).toHaveAttribute("data-appliance", "cortaix-factory");
  await expect(page.getByRole("navigation", { name: "Setup stages" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Setup evidence" })).toBeVisible();

  for (const [track, title] of tracks) {
    await page
      .getByRole("navigation", { name: "Setup stages" })
      .getByRole("button", {
        name: new RegExp(`^${track}`),
      })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`track=${track.toLowerCase()}`));
  }

  await page
    .getByRole("navigation", { name: "Setup stages" })
    .getByRole("button", { name: /^Inference/ })
    .click();
  const inferenceStages = page.getByRole("navigation", {
    name: "Inference commissioning stages",
  });
  for (const stage of ["Storage", "Runtime", "Model", "Acquire", "Serve", "Verify"]) {
    await expect(inferenceStages.getByRole("button", { name: new RegExp(stage) })).toBeVisible();
  }

  const footer = page.getByRole("contentinfo", {
    name: /Confidential classification, derived from appliance profile/,
  });
  await expect(footer).toBeVisible();
  await expect(footer).toContainText("C2");
  await expect(footer).toContainText("mode changes deployment, not governance semantics");
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);

  const screenshot = testInfo.outputPath("setup-commissioning-desktop.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("Commissioning desktop", { path: screenshot, contentType: "image/png" });
});

test("commissioning persists editable TensorPrime projections and fails C2 completion closed", async ({
  page,
}) => {
  const errors = observeFailures(page);
  await page.goto("/setup?track=environment");
  const inferenceProjection = page.getByRole("region", {
    name: "Inference API probe projection",
  });
  await expect(inferenceProjection).toBeVisible();
  await inferenceProjection.getByLabel("Probe path").fill("/healthz");
  await page.getByRole("button", { name: "Save probe projections" }).click();
  await expect(page.getByRole("button", { name: "Save probe projections" })).toBeEnabled();

  await page.reload();
  await expect(
    page.getByRole("region", { name: "Inference API probe projection" }).getByLabel("Probe path"),
  ).toHaveValue("/healthz");

  await page
    .getByRole("navigation", { name: "Setup stages" })
    .getByRole("button", { name: /^Review/ })
    .click();
  await expect(page.getByRole("heading", { name: "TensorPrime service routes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete commissioning" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("commissioning preserves other evidence when one source fails", async ({ page }) => {
  const errors = observeFailures(page);
  await page.route("**/api/agent/access-fabric", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Hermetic source failure" }),
    });
  });
  await page.goto("/setup?track=review");
  await expect(page.getByRole("heading", { name: "Private access fabric" })).toBeVisible();
  await expect(
    page.locator("#setup-content").getByText("apply recovery requires operator action."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "TensorPrime service routes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "OIDC issuer metadata" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete commissioning" })).toBeDisabled();
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("503");
});

test("commissioning remains keyboard and narrow-viewport usable", async ({ page }) => {
  const errors = observeFailures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/setup?track=environment");
  await expect(
    page.getByRole("heading", { level: 1, name: "Connect the execution environment" }),
  ).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to setup" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#setup-content")).toBeFocused();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("commissioning resolves cortAIx light, dark, high contrast, and forced colors", async ({
  page,
}) => {
  const errors = observeFailures(page);
  await page.goto("/settings#appearance");
  const colorMode = page.getByRole("tablist", { name: "Color mode" });
  const contrastMode = page.getByRole("tablist", { name: "Contrast mode" });

  await colorMode.getByRole("tab", { name: "Light" }).click();
  await page.goto("/setup");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "cortaix-light");
  await expect(page.locator(".appliance-brand-mark__light").first()).toBeVisible();

  await page.goto("/settings#appearance");
  await colorMode.getByRole("tab", { name: "Dark" }).click();
  await page.goto("/setup");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "cortaix-dark");
  await expect(page.locator(".appliance-brand-mark__dark").first()).toBeVisible();

  await page.goto("/settings#appearance");
  await contrastMode.getByRole("tab", { name: "High" }).click();
  await page.goto("/setup");
  await expect(page.locator("html")).toHaveAttribute("data-contrast-mode", "high");
  await expect(page.locator(".appliance-brand-mark__high-contrast").first()).toBeVisible();

  await page.goto("/settings#appearance");
  await contrastMode.getByRole("tab", { name: "Standard" }).click();
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/setup");
  await expect(page.locator(".appliance-brand-mark__forced-colors").first()).toBeVisible();
  expect(errors).toEqual([]);
});
