import { expect, test } from "@playwright/test";

test("cortAIx light persists from Appearance through science reload", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const hydrationErrors: string[] = [];
  const failedBrandAssets: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error") consoleErrors.push(text);
    if (/hydration|server rendered|didn't match/i.test(text)) hydrationErrors.push(text);
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
    if (/hydration|server rendered|didn't match/i.test(error.message)) {
      hydrationErrors.push(error.message);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/appliances/cortaix-factory/cortaix-logo-")) {
      failedBrandAssets.push(`${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    }
  });
  page.on("response", (response) => {
    if (
      response.url().includes("/appliances/cortaix-factory/cortaix-logo-") &&
      response.status() >= 400
    ) {
      failedBrandAssets.push(`${response.url()} ${response.status()}`);
    }
  });
  await page.addInitScript(() => {
    const trackedWindow = window as typeof window & {
      __themeSequence?: Array<{ phase: string; theme: string | null }>;
    };
    trackedWindow.__themeSequence = [];
    const record = (phase: string) => {
      trackedWindow.__themeSequence?.push({
        phase,
        theme: document.documentElement?.getAttribute("data-theme") ?? null,
      });
    };
    const observeRoot = () => {
      if (!document.documentElement) {
        setTimeout(observeRoot, 0);
        return;
      }
      record("root-ready");
      new MutationObserver(() => record("mutation")).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    };
    record("init-before-root");
    observeRoot();
    document.addEventListener("DOMContentLoaded", () => record("dom-content-loaded"));
    window.addEventListener("load", () => record("load"));
  });
  await page.goto("/settings#appearance");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();

  const mode = page.getByRole("tablist", { name: "Color mode" });
  const light = mode.getByRole("tab", { name: "Light" });
  await light.click();
  await expect(light).toHaveAttribute("aria-selected", "true");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("local-studio-state");
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { state?: { themeId?: string } };
        return parsed.state?.themeId ?? null;
      }),
    )
    .toBe("cortaix-light");

  await expect
    .poll(() =>
      page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        background: document.documentElement.style.getPropertyValue("--bg"),
        surface: document.documentElement.style.getPropertyValue("--surface"),
      })),
    )
    .toEqual({
      theme: "cortaix-light",
      background: "#f7f7f9",
      surface: "#ffffff",
    });

  await page.goto("/science");
  await expect(page).toHaveURL(/\/science$/);
  await expect(page.getByRole("heading", { name: "Scientific workbench" })).toBeVisible();
  await expect(
    page.locator("header").getByRole("button", { name: "Create notebook" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notebook sessions", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Scientific workbench" })).toBeVisible();
  await page.waitForLoadState("load");
  await page.waitForTimeout(100);

  const measured = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector("main");
    return {
      theme: root.dataset.theme,
      storedTheme: (
        JSON.parse(localStorage.getItem("local-studio-state") ?? "{}") as {
          state?: { themeId?: string };
        }
      ).state?.themeId,
      backgroundToken: root.style.getPropertyValue("--bg"),
      surfaceToken: root.style.getPropertyValue("--surface"),
      mainBackground: main ? getComputedStyle(main).backgroundColor : null,
      mainForeground: main ? getComputedStyle(main).color : null,
    };
  });
  const themeSequence = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __themeSequence?: Array<{ phase: string; theme: string | null }>;
        }
      ).__themeSequence ?? [],
  );
  const firstLight = themeSequence.findIndex(({ theme }) => theme === "cortaix-light");
  expect(firstLight).toBeGreaterThanOrEqual(0);
  expect(themeSequence.slice(firstLight).every(({ theme }) => theme === "cortaix-light")).toBe(
    true,
  );
  expect(themeSequence.some(({ phase }) => phase === "dom-content-loaded")).toBe(true);
  expect(themeSequence.some(({ phase }) => phase === "load")).toBe(true);
  const notebookMetric = page
    .getByText("Notebooks", { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'min-h-')][1]");
  await expect(notebookMetric).toBeVisible();
  const panelBackground = await notebookMetric.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  expect(measured).toEqual({
    theme: "cortaix-light",
    storedTheme: "cortaix-light",
    backgroundToken: "#f7f7f9",
    surfaceToken: "#ffffff",
    mainBackground: "rgb(247, 247, 249)",
    mainForeground: "rgb(19, 19, 25)",
  });
  expect(panelBackground).toBe("rgb(255, 255, 255)");
  const brandVariants = page.locator('[class*="appliance-brand-mark__"]');
  const visibleBrandVariants = () =>
    brandVariants.evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        }).length,
    );
  const lightBrand = page.locator(".appliance-brand-mark__light").first();
  await expect(lightBrand).toBeVisible();
  await expect(lightBrand).toHaveAttribute("src", /cortaix-logo-light\.svg$/);
  expect(
    await lightBrand.evaluate(
      (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
    ),
  ).toBe(true);
  await expect(page.locator(".appliance-brand-mark__dark").first()).toBeHidden();
  await expect(page.locator(".appliance-brand-mark__high-contrast").first()).toBeHidden();
  await expect(page.locator(".appliance-brand-mark__forced-colors").first()).toBeHidden();
  expect(await visibleBrandVariants()).toBe(1);

  const lightScreenshot = testInfo.outputPath("cortaix-light-science.png");
  await page.screenshot({ path: lightScreenshot, fullPage: true });
  await testInfo.attach("cortAIx light science", {
    path: lightScreenshot,
    contentType: "image/png",
  });

  await page.goto("/settings#appearance");
  const dark = page.getByRole("tablist", { name: "Color mode" }).getByRole("tab", {
    name: "Dark",
  });
  await dark.click();
  await expect(dark).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const parsed = JSON.parse(localStorage.getItem("local-studio-state") ?? "{}") as {
          state?: { themeId?: string };
        };
        return parsed.state?.themeId ?? null;
      }),
    )
    .toBe("cortaix-dark");

  await page.goto("/science");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Scientific workbench" })).toBeVisible();
  const darkMeasured = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector("main");
    const metric = Array.from(document.querySelectorAll("div")).find((element) =>
      element.classList.contains("min-h-[88px]"),
    );
    return {
      theme: root.dataset.theme,
      storedTheme: (
        JSON.parse(localStorage.getItem("local-studio-state") ?? "{}") as {
          state?: { themeId?: string };
        }
      ).state?.themeId,
      backgroundToken: root.style.getPropertyValue("--bg"),
      surfaceToken: root.style.getPropertyValue("--surface"),
      mainBackground: main ? getComputedStyle(main).backgroundColor : null,
      mainForeground: main ? getComputedStyle(main).color : null,
      panelBackground: metric ? getComputedStyle(metric).backgroundColor : null,
    };
  });
  expect(darkMeasured).toEqual({
    theme: "cortaix-dark",
    storedTheme: "cortaix-dark",
    backgroundToken: "#131319",
    surfaceToken: "#24252f",
    mainBackground: "rgb(19, 19, 25)",
    mainForeground: "rgb(247, 247, 249)",
    panelBackground: "rgb(36, 37, 47)",
  });
  const darkBrand = page.locator(".appliance-brand-mark__dark").first();
  await expect(darkBrand).toBeVisible();
  await expect(darkBrand).toHaveAttribute("src", /cortaix-logo-dark\.svg$/);
  expect(
    await darkBrand.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
  ).toBe(true);
  await expect(page.locator(".appliance-brand-mark__light").first()).toBeHidden();
  await expect(page.locator(".appliance-brand-mark__high-contrast").first()).toBeHidden();
  await expect(page.locator(".appliance-brand-mark__forced-colors").first()).toBeHidden();
  expect(await visibleBrandVariants()).toBe(1);

  const darkScreenshot = testInfo.outputPath("cortaix-dark-science.png");
  await page.screenshot({ path: darkScreenshot, fullPage: true });
  await testInfo.attach("cortAIx dark science", {
    path: darkScreenshot,
    contentType: "image/png",
  });

  await page.goto("/settings#appearance");
  const contrast = page.getByRole("tablist", { name: "Contrast mode" });
  await contrast.getByRole("tab", { name: "High" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-contrast-mode", "high");
  const highContrastBrand = page.locator(".appliance-brand-mark__high-contrast").first();
  await expect(highContrastBrand).toBeVisible();
  await expect(highContrastBrand).toHaveAttribute("src", /cortaix-logo-highcontrast\.svg$/);
  expect(
    await highContrastBrand.evaluate(
      (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
    ),
  ).toBe(true);
  await expect(page.locator(".appliance-brand-mark__light").first()).toBeHidden();
  await expect(page.locator(".appliance-brand-mark__dark").first()).toBeHidden();
  await expect(page.locator(".appliance-brand-mark__forced-colors").first()).toBeHidden();
  expect(await visibleBrandVariants()).toBe(1);

  await contrast.getByRole("tab", { name: "Standard" }).click();
  await page.emulateMedia({ forcedColors: "active" });
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  const forcedColorsBrand = page.locator(".appliance-brand-mark__forced-colors").first();
  await expect(forcedColorsBrand).toBeVisible();
  await expect(forcedColorsBrand).toHaveAttribute("src", /cortaix-logo-forcedcolors\.svg$/);
  expect(
    await forcedColorsBrand.evaluate(
      (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
    ),
  ).toBe(true);
  await expect(page.locator(".appliance-brand-mark__high-contrast").first()).toBeHidden();
  await expect(page.locator(".appliance-brand-mark__light").first()).toBeHidden();
  await expect(page.locator(".appliance-brand-mark__dark").first()).toBeHidden();
  expect(await visibleBrandVariants()).toBe(1);
  expect(failedBrandAssets).toEqual([]);
  expect(hydrationErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
