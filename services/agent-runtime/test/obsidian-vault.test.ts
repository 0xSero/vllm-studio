import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasObsidianVaultSync, listObsidianVaultsSync } from "../src/obsidian-vault";
import { buildAgentSessionOptionsSync } from "../src/pi-runtime-helpers";
import { cleanTemps, tempDir } from "./test-fixtures";

const original = process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG;
afterEach(() => {
  if (original === undefined) delete process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG;
  else process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG = original;
});
afterAll(cleanTemps);

type Vaults = Record<string, { path: string; ts?: number; open?: boolean }>;
function fixture(vaults: Vaults): void {
  const file = path.join(tempDir("obsidian-config-"), "obsidian.json");
  writeFileSync(file, JSON.stringify({ vaults }));
  process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG = file;
}
function vault(name: string): string {
  const dir = path.join(tempDir("obsidian-vault-"), name);
  mkdirSync(dir);
  return dir;
}
const missing = () => {
  process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG = path.join(tmpdir(), "no-such-obsidian.json");
};
const options = () =>
  buildAgentSessionOptionsSync({
    options: {},
    processEnv: {},
  });

test("open and recent vaults sort first", () => {
  const old = vault("Old"),
    recent = vault("Recent"),
    open = vault("Open");
  fixture({
    a: { path: old, ts: 1_000 },
    b: { path: recent, ts: 9_000 },
    c: { path: open, ts: 5_000, open: true },
  });
  expect(listObsidianVaultsSync().map(({ name }) => name)).toEqual(["Open", "Recent", "Old"]);
});

test("missing vault directories are dropped", () => {
  const present = vault("Present");
  fixture({
    a: { path: present, ts: 2 },
    b: { path: path.join(tmpdir(), "never-existed"), ts: 3 },
  });
  expect(listObsidianVaultsSync().map(({ path: value }) => value)).toEqual([present]);
});

test("Obsidian never running reports no vaults", () => {
  missing();
  expect(listObsidianVaultsSync()).toEqual([]);
  expect(hasObsidianVaultSync()).toBe(false);
});

test("partial config writes are tolerated", () => {
  const file = path.join(tempDir("obsidian-config-"), "obsidian.json");
  writeFileSync(file, '{"vaults":{"a":{"path":"/tmp/x"');
  process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG = file;
  expect(listObsidianVaultsSync()).toEqual([]);
});

test("session options export resolved vaults", () => {
  const dir = vault("Notes");
  fixture({ a: { path: dir, ts: 7, open: true } });
  expect(JSON.parse(options().envInjections.LOCAL_STUDIO_OBSIDIAN_VAULTS ?? "[]")).toEqual([
    { path: dir, name: "Notes", open: true, lastOpened: new Date(7).toISOString() },
  ]);
});

test("session options export nothing without a vault", () => {
  missing();
  const result = options();
  expect(result.envInjections.LOCAL_STUDIO_OBSIDIAN_VAULTS).toBeUndefined();
  expect(result.extensionPaths.some((entry) => entry.endsWith("obsidian.ts"))).toBe(false);
});
