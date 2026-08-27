import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Option, Schema } from "effect";
import { chromium } from "playwright-core";
import { resolveDataDir } from "../data-dir";

export type BrowserEngineId =
  | "auto"
  | "bundled"
  | "chrome"
  | "chromium"
  | "brave"
  | "edge"
  | "arc"
  | "vivaldi";

export const BROWSER_ENGINE_IDS: readonly BrowserEngineId[] = [
  "auto",
  "bundled",
  "chrome",
  "chromium",
  "brave",
  "edge",
  "arc",
  "vivaldi",
];

export type BrowserEngineInfo = {
  id: BrowserEngineId;
  label: string;
  path: string | null;
};

export type ResolvedBrowserEngine = {
  id: BrowserEngineId | "custom";
  label: string;
  path: string;
  source: "override" | "preference" | "bundled" | "detected";
};

export class BrowserEngineError extends Error {}

type EngineSpec = {
  id: BrowserEngineId;
  label: string;
  locate: () => string | null;
};

const PREFERENCE_FILE = "browser-engine.json";

const resolveOnPath = (binary: string): string | null => {
  try {
    const resolved = execFileSync("which", [binary], { encoding: "utf8" }).trim();
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
};

const specs = (
  entries: Array<[BrowserEngineId, string, string[]]>,
  locate: (names: string[]) => string | null,
): EngineSpec[] =>
  entries.map(([id, label, names]) => ({ id, label, locate: () => locate(names) }));

function engineSpecs(): EngineSpec[] {
  if (process.platform === "darwin") {
    return specs(
      [
        [
          "chrome",
          "Google Chrome",
          ["Google Chrome", "Google Chrome Beta", "Google Chrome Canary"],
        ],
        ["chromium", "Chromium", ["Chromium"]],
        ["brave", "Brave", ["Brave Browser", "Brave Browser Beta", "Brave Browser Nightly"]],
        ["edge", "Microsoft Edge", ["Microsoft Edge"]],
        ["arc", "Arc", ["Arc"]],
        ["vivaldi", "Vivaldi", ["Vivaldi"]],
      ],
      (names) =>
        names.map((name) => `/Applications/${name}.app/Contents/MacOS/${name}`).find(existsSync) ??
        null,
    );
  }
  if (process.platform === "win32") {
    const roots = [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ].filter((value): value is string => Boolean(value));
    return specs(
      [
        [
          "chrome",
          "Google Chrome",
          [
            "Google\\Chrome\\Application\\chrome.exe",
            "Google\\Chrome Beta\\Application\\chrome.exe",
          ],
        ],
        ["chromium", "Chromium", ["Chromium\\Application\\chrome.exe"]],
        ["brave", "Brave", ["BraveSoftware\\Brave-Browser\\Application\\brave.exe"]],
        ["edge", "Microsoft Edge", ["Microsoft\\Edge\\Application\\msedge.exe"]],
        ["vivaldi", "Vivaldi", ["Vivaldi\\Application\\vivaldi.exe"]],
      ],
      (names) =>
        roots.flatMap((root) => names.map((name) => path.join(root, name))).find(existsSync) ??
        null,
    );
  }
  return specs(
    [
      ["chromium", "Chromium", ["chromium-browser", "chromium"]],
      ["chrome", "Google Chrome", ["google-chrome-stable", "google-chrome"]],
      ["brave", "Brave", ["brave-browser"]],
      ["edge", "Microsoft Edge", ["microsoft-edge", "microsoft-edge-stable"]],
      ["vivaldi", "Vivaldi", ["vivaldi-stable"]],
    ],
    (names) => names.map(resolveOnPath).find((value): value is string => Boolean(value)) ?? null,
  );
}

function bundledPath(): string | null {
  try {
    const bundled = chromium.executablePath();
    return bundled && existsSync(bundled) ? bundled : null;
  } catch {
    return null;
  }
}

const BrowserEnginePreferenceSchema = Schema.Struct({
  engine: Schema.Literals(BROWSER_ENGINE_IDS),
});
const browserEngineIds = new Set<string>(BROWSER_ENGINE_IDS);
export const isBrowserEngineId = (value: string | undefined): value is BrowserEngineId =>
  value !== undefined && browserEngineIds.has(value);

function preferenceFilePath(): string {
  return path.join(resolveDataDir(), PREFERENCE_FILE);
}

export function readEnginePreference(): BrowserEngineId {
  try {
    const parsed = Schema.decodeUnknownOption(BrowserEnginePreferenceSchema)(
      JSON.parse(readFileSync(preferenceFilePath(), "utf8")),
    );
    if (Option.isSome(parsed)) return parsed.value.engine;
  } catch {}
  const fromEnv = process.env.LOCAL_STUDIO_BROWSER_ENGINE?.trim().toLowerCase();
  return isBrowserEngineId(fromEnv) ? fromEnv : "auto";
}

export function writeEnginePreference(engine: BrowserEngineId): void {
  const file = preferenceFilePath();
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify({ engine }, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

export function explicitBinaryOverride(): string | null {
  return process.env.LOCAL_STUDIO_CHROME_PATH?.trim() || null;
}

export function listBrowserEngines(): BrowserEngineInfo[] {
  return [
    { id: "auto", label: "Automatic", path: autoPath() },
    { id: "bundled", label: "Bundled Chromium", path: bundledPath() },
    ...engineSpecs().map((spec) => ({ id: spec.id, label: spec.label, path: spec.locate() })),
  ];
}

function autoPath(): string | null {
  return (
    bundledPath() ??
    engineSpecs().reduce<string | null>((found, spec) => found ?? spec.locate(), null)
  );
}

const warnedStaleOverrides = new Set<string>();

export function resolveBrowserEngine(): ResolvedBrowserEngine {
  const override = explicitBinaryOverride();
  if (override) {
    if (existsSync(override)) {
      return { id: "custom", label: overrideLabel(override), path: override, source: "override" };
    }
    if (!warnedStaleOverrides.has(override)) {
      warnedStaleOverrides.add(override);
      console.warn(
        `[browser-engines] LOCAL_STUDIO_CHROME_PATH points at a missing binary (${override}); falling back to auto-detection`,
      );
    }
  }

  const preference = readEnginePreference();
  if (preference !== "auto") {
    const chosen = listBrowserEngines().find((engine) => engine.id === preference);
    if (chosen?.path) {
      return {
        id: chosen.id,
        label: chosen.label,
        path: chosen.path,
        source: preference === "bundled" ? "bundled" : "preference",
      };
    }
  }

  const bundled = bundledPath();
  if (bundled) {
    return { id: "bundled", label: "Bundled Chromium", path: bundled, source: "bundled" };
  }
  for (const spec of engineSpecs()) {
    const found = spec.locate();
    if (found) return { id: spec.id, label: spec.label, path: found, source: "detected" };
  }
  throw new BrowserEngineError(
    "Browser unavailable: no Chromium-based browser found — install Chrome or Brave, or set LOCAL_STUDIO_CHROME_PATH",
  );
}

function overrideLabel(binary: string): string {
  const base = path.basename(binary).replace(/\.exe$/i, "");
  return `${base} (LOCAL_STUDIO_CHROME_PATH)`;
}

export function tryResolveBrowserEngine(): ResolvedBrowserEngine | null {
  try {
    return resolveBrowserEngine();
  } catch {
    return null;
  }
}
