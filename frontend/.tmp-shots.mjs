import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3217;
const BASE = `http://127.0.0.1:${PORT}`;
const FRONTEND = new URL(".", import.meta.url).pathname;

const server = spawn("node", ["node_modules/.bin/next", "dev", "-p", String(PORT)], {
  cwd: FRONTEND,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const waitUp = async () => {
  const deadline = Date.now() + 200000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/configure?section=models", { redirect: "manual" });
      if (r.status) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(serverLog.slice(-3000));
  throw new Error("dev server never came up");
};

const killTree = () => {
  try { process.kill(-server.pid, "SIGKILL"); } catch { try { server.kill("SIGKILL"); } catch {} }
};

try {
  await waitUp();
  const browser = await chromium.launch({
    executablePath: "/Users/sero/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${BASE}/configure?section=models`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(10000);

  await page.getByRole("button", { name: "Serves" }).first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "shot-1-list.png" });

  const name = page.locator("text=GLM-5.2-EXL3").first();
  if (await name.count()) {
    await name.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "shot-2-expanded.png" });
    const del = page.locator("text=Delete").last();
    if (await del.count()) {
      await del.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: "shot-3-confirm.png" });
    }
  } else {
    console.log("SERVE ROW NOT FOUND:");
    console.log((await page.locator("body").innerText()).slice(0, 1200));
  }
  await browser.close();
  console.log("done");
} finally {
  killTree();
}
