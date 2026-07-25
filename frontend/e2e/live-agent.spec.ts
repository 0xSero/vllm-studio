import { expect, test, type Page } from "@playwright/test";
import { liveSessionFilesContaining, removeLiveSessionFiles } from "./live-controller";

const waitForResponse = async (page: Page, expectedResponses: number) => {
  await expect(page.getByRole("button", { name: "Copy response" })).toHaveCount(expectedResponses, {
    timeout: 240_000,
  });
  await expect(page.getByText("Thinking", { exact: true })).toBeHidden();
};

test("the live DS4 agent uses Browser tools across two turns", async ({ page }) => {
  test.setTimeout(360_000);
  const marker = `e2e-live-session-${Date.now()}`;
  const title = `Live DS4 Browser ${Date.now()}`;
  await page.goto(`/agent?new=${encodeURIComponent(title)}`);
  await page.waitForLoadState("domcontentloaded");

  try {
    await test.step("Confirm the Spark model and enable Browser tools", async () => {
      const modelPicker = page.getByRole("button", { name: /^Model:/ }).first();
      await expect(modelPicker).toBeEnabled({ timeout: 60_000 });
      const selectedModel = page.getByRole("button", {
        name: /^Model: deepseek-v4-flash-dspark/,
      });
      if ((await selectedModel.count()) === 0) {
        await modelPicker.click();
        await page.getByRole("menuitem", { name: /^DGX Spark\b/ }).click();
        await page.getByText("deepseek-v4-flash-dspark", { exact: true }).last().click();
      }
      await expect(selectedModel).toBeVisible();
      const browserTools = page.getByRole("button", { name: "Browser tools" });
      await browserTools.click();
      await expect(browserTools).toHaveAttribute("aria-pressed", "true");
    });

    await test.step("Ask DS4 to inspect localstudio.ai with Browser tools", async () => {
      const prompt = `${marker}: Use Browser tools to open https://localstudio.ai, read the page, and report the main heading in one short sentence.`;
      const composer = page.getByPlaceholder("Ask for follow-up changes").first();
      await composer.fill(prompt);
      await composer.press("Enter");
      await expect(page.getByText(prompt, { exact: true })).toBeVisible();
      await waitForResponse(page, 1);
      await expect(page.getByText(/Browsed [1-9][0-9]* page/i)).toBeVisible();
      await expect(page.locator("[data-timeline-message-id]").last()).toContainText(
        /Run your intelligence at home/i,
      );
    });

    await test.step("Send a follow-up in the same live session", async () => {
      const prompt =
        "Without opening a different site, confirm whether the page describes running AI at home.";
      const composer = page.getByPlaceholder("Ask for follow-up changes").first();
      await composer.fill(prompt);
      await composer.press("Enter");
      await expect(page.getByText(prompt, { exact: true })).toBeVisible();
      await waitForResponse(page, 2);
      await expect(page.locator("[data-timeline-message-id]").last()).toContainText(/home/i);
    });

    await test.step("Rename the live task and navigate away and back", async () => {
      await page.getByRole("button", { name: "Session settings" }).first().click();
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      const rename = page.getByRole("textbox", { name: "Rename session", exact: true });
      await rename.fill(title);
      await rename.press("Enter");
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
      await page.getByTitle("Usage").click();
      await expect(page.getByRole("heading", { name: "Usage", exact: true })).toBeVisible();
      await page.getByTitle("Workbench").click();
      const savedSession = page.getByRole("link", { name: title, exact: true });
      await expect(savedSession).toBeVisible();
      await savedSession.click();
      await expect(page.getByRole("button", { name: "Copy response" })).toHaveCount(2);
    });

    await test.step("Verify the canonical live session store", async () => {
      await expect.poll(() => liveSessionFilesContaining(marker).length).toBe(1);
      const files = liveSessionFilesContaining(marker);
      const content = await import("node:fs").then(({ readFileSync }) =>
        readFileSync(files[0] as string, "utf8"),
      );
      expect(content).toContain(marker);
      expect(content).toContain("Without opening a different site");
      expect(content).toMatch(/browser/i);
    });
  } finally {
    const files = liveSessionFilesContaining(marker);
    await page.close();
    removeLiveSessionFiles(files);
  }
});
