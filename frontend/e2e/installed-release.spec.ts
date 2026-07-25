import { expect, test } from "@playwright/test";
import {
  liveControllerHeaders,
  readLiveControllerConfig,
  readLiveRecipe,
  selectLiveController,
} from "./live-controller";

test("the installed signed build persists controller changes in the Spark live database", async ({
  context,
  page,
}) => {
  const id = `e2e-live-db-${Date.now()}`;
  await selectLiveController(context, page);
  await page.goto("/configure");
  await expect(page.getByRole("heading", { name: "Configure", exact: true })).toBeVisible();
  const config = await readLiveControllerConfig(page);
  expect(config.host).toBe("100.83.190.2");
  expect(config.db_path).toContain("/spark/deepseek-spark/studio-data/controller.db");
  expect(readLiveRecipe(config, id)).toBeNull();

  const headers = { ...liveControllerHeaders(), "Content-Type": "application/json" };
  try {
    const create = await page.request.post("/api/proxy/recipes", {
      headers,
      data: { id, name: id, model_path: `/tmp/${id}` },
    });
    expect(create.ok()).toBeTruthy();
    expect(readLiveRecipe(config, id)).toMatchObject({ id, name: id, model_path: `/tmp/${id}` });
    const read = await page.request.get(`/api/proxy/recipes/${id}`, { headers });
    expect(read.ok()).toBeTruthy();
    await expect(read.json()).resolves.toMatchObject({ id, name: id });
  } finally {
    await page.request.delete(`/api/proxy/recipes/${id}`, { headers });
  }

  expect(readLiveRecipe(config, id)).toBeNull();
});
