import { expect, test } from "@playwright/test";

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
  });
}

for (const [route, destination] of [
  ["/discover", "/configure?section=models#models"],
  ["/integrations", "/configure?section=integrations#integrations"],
  ["/recipes", "/configure?section=models#models"],
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
