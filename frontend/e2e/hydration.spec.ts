import { expect, test } from "@playwright/test";
import { readLiveControllerConfig, selectLiveController } from "./live-controller";

for (const path of [
  "/",
  "/usage",
  "/models",
  "/configure",
  "/settings",
  "/agent",
  "/agent/automations",
  "/quick",
  "/setup",
  "/recipes",
  "/discover",
  "/integrations",
  "/server",
  "/logs",
]) {
  test(`${path} hydrates against the Spark live controller`, async ({ context, page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await selectLiveController(context, page);
    const config = await readLiveControllerConfig(page);
    expect(config.db_path).toContain("/spark/deepseek-spark/studio-data/controller.db");
    const response = await page.goto(path);
    expect(response?.ok()).toBeTruthy();
    await page.waitForTimeout(1_000);
    expect(errors).toEqual([]);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
  });
}
