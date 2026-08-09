import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3215;
const BASE = `http://localhost:${PORT}`;
const FRONTEND = new URL("./frontend", import.meta.url).pathname;

const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
  cwd: FRONTEND,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "development" },
});
server.stderr.on("data", (d) => process.stderr.write(d));

const waitUp = async () => {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE, { redirect: "manual" });
      if (r.status) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server never came up");
};

try {
  await waitUp();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${BASE}/configure?section=models`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "shot-1-list.png" });

  const row = page.locator("text=GLM-5.2-EXL3").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "shot-2-expanded.png" });
    const del = page.locator("text=Delete").last();
    if (await del.count()) {
      await del.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: "shot-3-confirm.png" });
    }
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
  setTimeout(() => server.kill("SIGKILL"), 2000).unref();
}
console.log("done");
