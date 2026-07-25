import { expect, test } from "@playwright/test";
import { readLiveControllerConfig, selectLiveController } from "./live-controller";

for (const path of [
  "/",
  "/usage",
  "/configure",
  "/settings",
  "/agent",
  "/agent/sessions",
  "/quick",
  "/setup",
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
    await page.goto(path);
    await page.waitForTimeout(1_000);
    expect(errors).toEqual([]);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
  });
}
