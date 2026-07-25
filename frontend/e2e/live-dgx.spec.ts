import { expect, test } from "@playwright/test";
import {
  liveControllerHeaders,
  liveControllerKey,
  liveControllerRequestCount,
  liveControllerRequestsAfter,
  liveControllerUrl,
  newestLiveControllerRequestId,
  readLiveControllerConfig,
  selectLiveController,
} from "./live-controller";

test("Local Studio renders and talks to the live DS4 DGX Spark", async ({ page, context }) => {
  await selectLiveController(context, page);

  await test.step("Render the live DGX Spark status", async () => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText("controllers live", { exact: true })).toBeVisible();
    await expect(page.getByText("DGX Spark", { exact: true })).toBeVisible();
    await expect(page.getByText("deepseek-v4-flash-dspark", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("GB10", { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(2_000);
  });

  await test.step("Verify the controller model catalog", async () => {
    const models = await page.evaluate(
      async ({ key, url }) => {
        const response = await fetch("/api/proxy/v1/models", {
          headers: {
            Authorization: `Bearer ${key}`,
            "x-backend-url": url,
            "x-backend-strict": "1",
          },
        });
        if (!response.ok) throw new Error(`models failed: ${response.status}`);
        return response.json();
      },
      { key: liveControllerKey, url: liveControllerUrl },
    );
    expect(models.data.map((model: { id: string }) => model.id)).toContain(
      "deepseek-v4-flash-dspark",
    );
  });

  await test.step("Run two DS4 turns through Local Studio", async () => {
    const config = await readLiveControllerConfig(page);
    const beforeId = newestLiveControllerRequestId(config);
    const beforeCount = liveControllerRequestCount(config);
    const messages = [
      { role: "user", content: "Reply with one short sentence confirming this is DS4 turn one." },
    ];
    const first = await page.evaluate(
      async ({ key, messages, url }) => {
        const response = await fetch("/api/proxy/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "x-backend-url": url,
            "x-backend-strict": "1",
          },
          body: JSON.stringify({ model: "deepseek-v4-flash-dspark", messages, stream: false }),
        });
        if (!response.ok) throw new Error(`turn one failed: ${response.status}`);
        return response.json();
      },
      { key: liveControllerKey, messages, url: liveControllerUrl },
    );
    const firstText = first.choices?.[0]?.message?.content;
    expect(typeof firstText).toBe("string");
    expect(firstText.trim().length).toBeGreaterThan(0);
    messages.push({ role: "assistant", content: firstText });
    messages.push({
      role: "user",
      content: "Now confirm in one short sentence that this is turn two.",
    });
    const second = await page.evaluate(
      async ({ key, messages, url }) => {
        const response = await fetch("/api/proxy/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "x-backend-url": url,
            "x-backend-strict": "1",
          },
          body: JSON.stringify({ model: "deepseek-v4-flash-dspark", messages, stream: false }),
        });
        if (!response.ok) throw new Error(`turn two failed: ${response.status}`);
        return response.json();
      },
      { key: liveControllerKey, messages, url: liveControllerUrl },
    );
    const secondText = second.choices?.[0]?.message?.content;
    expect(typeof secondText).toBe("string");
    expect(secondText.trim().length).toBeGreaterThan(0);
    await expect
      .poll(() => liveControllerRequestCount(config), { timeout: 20_000 })
      .toBeGreaterThan(beforeCount);
    const persisted = liveControllerRequestsAfter(config, beforeId, "/v1/chat/completions");
    expect(
      persisted.filter((request) => request.status === 200 && request.success === 1),
    ).toHaveLength(2);
  });
});
