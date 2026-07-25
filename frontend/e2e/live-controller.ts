import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

export const liveControllerUrl = process.env.LIVE_DGX_URL || "http://100.83.190.2:8080";
export const liveControllerKey = process.env.LIVE_DGX_API_KEY || "";
export const liveControllerSsh = process.env.LIVE_DGX_SSH || "spark-2822";

export type LiveControllerConfig = {
  data_dir: string;
  db_path: string;
  host: string;
  port: number;
  inference_port: number;
};

type SqliteColumn = { name: string };

function parseJsonRows<T>(value: Buffer): T[] {
  const text = value.toString("utf8").trim();
  return text ? (JSON.parse(text) as T[]) : [];
}

function safeSqlValue(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function liveDataDir(): string {
  return (
    process.env.LIVE_LOCAL_STUDIO_DATA_DIR ||
    path.join(homedir(), "Library", "Application Support", "Local Studio")
  );
}

export async function selectLiveController(context: BrowserContext, page: Page): Promise<void> {
  if (!liveControllerKey) throw new Error("LIVE_DGX_API_KEY is required for live controller tests");
  const origin = new URL(process.env.LIVE_LOCAL_STUDIO_URL || "http://127.0.0.1:61449").origin;
  await context.addCookies([
    {
      name: "localstudio_backend_url",
      value: encodeURIComponent(liveControllerUrl),
      url: origin,
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript(
    ({ key, url }) => {
      localStorage.setItem("local-studio-setup-complete", "true");
      localStorage.setItem("localstudio_backend_url", url);
      localStorage.setItem(
        "local-studio.controllers",
        JSON.stringify([
          { name: "DGX Spark", url, apiKey: key },
          { name: "Local fallback", url: "http://127.0.0.1:8080" },
        ]),
      );
    },
    { key: liveControllerKey, url: liveControllerUrl },
  );
}

export function liveControllerHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${liveControllerKey}`,
    "x-backend-url": liveControllerUrl,
    "x-backend-strict": "1",
  };
}

export async function readLiveControllerConfig(page: Page): Promise<LiveControllerConfig> {
  const response = await page.request.get("/api/proxy/config", {
    headers: liveControllerHeaders(),
  });
  if (!response.ok()) throw new Error(`controller config failed: ${response.status()}`);
  const value = (await response.json()) as { config?: Partial<LiveControllerConfig> };
  const config = value.config;
  if (
    !config ||
    typeof config.data_dir !== "string" ||
    typeof config.db_path !== "string" ||
    typeof config.host !== "string" ||
    typeof config.port !== "number" ||
    typeof config.inference_port !== "number"
  ) {
    throw new Error("controller config did not identify its live database");
  }
  return config as LiveControllerConfig;
}

export function queryLiveControllerDb<T>(config: LiveControllerConfig, sql: string): T[] {
  if (!path.posix.isAbsolute(config.db_path) || config.db_path.includes("\n")) {
    throw new Error(`unsafe controller database path: ${config.db_path}`);
  }
  const output = execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      liveControllerSsh,
      "sqlite3",
      "-json",
      config.db_path,
    ],
    { input: `.timeout 10000\n${sql}`, timeout: 20_000 },
  );
  return parseJsonRows<T>(output);
}

export function readLiveRecipe(config: LiveControllerConfig, id: string): unknown | null {
  const columns = queryLiveControllerDb<SqliteColumn>(config, "PRAGMA table_info(recipes);");
  const payloadColumn = columns.some((column) => column.name === "data") ? "data" : "json";
  const rows = queryLiveControllerDb<{ payload: string }>(
    config,
    `SELECT ${payloadColumn} AS payload FROM recipes WHERE id = ${safeSqlValue(id)};`,
  );
  return rows[0]?.payload ? (JSON.parse(rows[0].payload) as unknown) : null;
}

export function liveControllerRequestCount(config: LiveControllerConfig): number {
  const rows = queryLiveControllerDb<{ count: number }>(
    config,
    "SELECT COUNT(*) AS count FROM controller_requests;",
  );
  return rows[0]?.count ?? 0;
}

export function liveControllerRequestsAfter(
  config: LiveControllerConfig,
  id: number,
  requestPath: string,
): Array<{ id: number; path: string; status: number; success: number }> {
  return queryLiveControllerDb(
    config,
    `SELECT id, path, status, success FROM controller_requests WHERE id > ${id} AND path = ${safeSqlValue(requestPath)} ORDER BY id;`,
  );
}

export function newestLiveControllerRequestId(config: LiveControllerConfig): number {
  const rows = queryLiveControllerDb<{ id: number }>(
    config,
    "SELECT COALESCE(MAX(id), 0) AS id FROM controller_requests;",
  );
  return rows[0]?.id ?? 0;
}

export function liveSessionFilesContaining(marker: string): string[] {
  const roots = [
    path.join(liveDataDir(), "pi-agent", "sessions"),
    path.join(homedir(), ".pi", "agent", "sessions"),
  ];
  for (const root of roots) {
    if (!path.isAbsolute(root) || root.startsWith(path.resolve("/tmp"))) {
      throw new Error(`session store is not a live store: ${root}`);
    }
  }
  const existingRoots = roots.filter(existsSync);
  if (existingRoots.length === 0) return [];
  try {
    const output = execFileSync("rg", ["-l", "-F", "--glob", "*.jsonl", marker, ...existingRoots], {
      encoding: "utf8",
      timeout: 20_000,
    });
    return output
      .trim()
      .split("\n")
      .map((filepath) => filepath.trim())
      .filter(Boolean);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return [];
    throw error;
  }
}

export function removeLiveSessionFiles(files: string[]): void {
  for (const filepath of files) rmSync(filepath, { force: true });
}
