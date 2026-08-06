import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import * as logFiles from "../src/core/log-files";
import { redactLogLine, redactLogTail } from "../src/core/log-redaction";
import { createLogger } from "../src/core/logger";
import { makeInstanceStore } from "../src/modules/compute/instances/store";

const temporaryDirectories: string[] = [];
const syntheticSecret = "synthetic-secret-never-persist";

const temporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(join(tmpdir(), "log-redaction-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("log redaction", () => {
  test("redacts supported credential forms idempotently", () => {
    const input = [
      `Authorization: Bearer ${syntheticSecret}`,
      `Authorization: Bearer "${syntheticSecret}"`,
      `{"authorization":"Bearer ${syntheticSecret}"}`,
      `X-Api-Key: ${syntheticSecret}`,
      `X-Api-Key: "prefix\\\"${syntheticSecret}"`,
      `OPENAI_API_KEY=${syntheticSecret}`,
      `{"api_key":"${syntheticSecret}"}`,
      `command --api-key=${syntheticSecret}`,
      `--api-key=${syntheticSecret}`,
      `--token ${syntheticSecret}`,
      `--api-key "${syntheticSecret}"`,
      `--token='${syntheticSecret}'`,
      `api_key: ${syntheticSecret}`,
      `password: "prefix\\\"${syntheticSecret}"`,
      `--password "prefix\\\"${syntheticSecret}"`,
      `--password "${syntheticSecret}`,
      `PASSWORD_TOKEN="prefix\\\"${syntheticSecret}"`,
      `PASSWORD_TOKEN="${syntheticSecret}\\`,
      `api_key: '${syntheticSecret}\\`,
      `--token "${syntheticSecret}\\`,
      `(OPENAI_API_KEY=${syntheticSecret})`,
      `[OPENAI_API_KEY=${syntheticSecret}]`,
      `env(OPENAI_API_KEY=${syntheticSecret})`,
      `["--api-key","${syntheticSecret}"]`,
      `argv=['--token','${syntheticSecret}']`,
      `--api-key,${syntheticSecret}`,
      `https://host.test/path?token=${syntheticSecret}`,
    ].join("\n");
    const once = redactLogLine(input);
    expect(once).not.toContain(syntheticSecret);
    expect(once).toContain("[redacted]");
    expect(redactLogLine(once)).toBe(once);
  });

  test("redacts before bounding a retained tail", () => {
    const maximumCharacters = `KEY=${syntheticSecret}`.length;
    const input = `prefix OPENAI_API_KEY=${syntheticSecret}`;
    expect(redactLogLine(input.slice(-maximumCharacters))).toContain(syntheticSecret);
    expect(redactLogTail(input, maximumCharacters)).not.toContain(syntheticSecret);
    expect(redactLogTail(input, maximumCharacters)).toContain("[redacted]");
  });

  test("uses the same redacted line for console, file, and event sinks", async () => {
    const root = temporaryDirectory();
    const filePath = logFiles.primaryLogPathFor(join(root, "data"), "controller");
    const events: string[] = [];
    const consoleLines: string[] = [];
    const original = console.info;
    console.info = (...values: unknown[]) => consoleLines.push(values.join(" "));
    try {
      const logger = createLogger("info", {
        filePath,
        onLine: (line) => events.push(line),
      });
      logger.info(`OPENAI_API_KEY=${syntheticSecret}`, {
        authorization: `Bearer ${syntheticSecret}`,
      });
      await Effect.runPromise(logger.shutdown());
    } finally {
      console.info = original;
    }
    const persisted = fs.readFileSync(filePath, "utf8").trimEnd();
    expect(persisted).not.toContain(syntheticSecret);
    expect(events).toEqual([persisted]);
    expect(consoleLines).toEqual([persisted]);
  });

  test("repairs private directory and file modes", async () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const dataDirectory = join(root, "data");
    const filePath = logFiles.primaryLogPathFor(dataDirectory, "controller");
    fs.writeFileSync(filePath, "existing\n", { mode: 0o644 });
    fs.chmodSync(dataDirectory, 0o755);
    fs.chmodSync(logFiles.ensureLogsDirectory(dataDirectory), 0o755);
    fs.chmodSync(filePath, 0o644);
    const logger = createLogger("info", { filePath });
    logger.info("safe");
    await Effect.runPromise(logger.shutdown());
    expect(fs.lstatSync(dataDirectory).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(join(dataDirectory, "logs")).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(filePath).mode & 0o777).toBe(0o600);
  });

  test("repairs existing primary and fallback logs before reads", () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const dataDirectory = join(root, "data");
    const primary = logFiles.primaryLogPathFor(dataDirectory, "existing");
    const sessionId = `fallback-${process.pid}-${Date.now()}`;
    const fallback = logFiles.fallbackLogPathFor(sessionId);
    fs.writeFileSync(primary, "primary", { mode: 0o644 });
    fs.chmodSync(primary, 0o644);
    fs.writeFileSync(fallback, "fallback", { mode: 0o644 });
    fs.chmodSync(fallback, 0o644);
    try {
      logFiles.ensureLogsDirectory(dataDirectory);
      expect(fs.lstatSync(primary).mode & 0o777).toBe(0o600);
      expect(fs.lstatSync(fallback).mode & 0o777).toBe(0o600);
      expect(logFiles.resolveExistingLogPath(dataDirectory, sessionId)).toBe(fallback);
    } finally {
      fs.rmSync(fallback, { force: true });
    }
  });

  test("repairs inactive instance logs when the store starts", () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const dataDirectory = join(root, "data");
    const instancesDirectory = join(dataDirectory, "instances");
    const logsDirectory = join(instancesDirectory, "logs");
    const logPath = join(logsDirectory, "inactive.log");
    fs.mkdirSync(logsDirectory, { recursive: true, mode: 0o755 });
    fs.writeFileSync(logPath, "existing", { mode: 0o644 });
    fs.chmodSync(instancesDirectory, 0o755);
    fs.chmodSync(logsDirectory, 0o755);
    fs.chmodSync(logPath, 0o644);
    makeInstanceStore(dataDirectory);
    expect(fs.lstatSync(instancesDirectory).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(logsDirectory).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(logPath).mode & 0o777).toBe(0o600);
  });

  test("rejects hard-linked log targets before truncation", () => {
    const root = temporaryDirectory();
    const target = join(root, "target.log");
    const filePath = logFiles.primaryLogPathFor(join(root, "data"), "controller");
    fs.writeFileSync(target, "unchanged");
    fs.linkSync(target, filePath);
    expect(() => logFiles.openPrivateLogFile(filePath, true)).toThrow("Unsafe log file");
    expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
  });

  test("rejects a replaced log directory before opening its files", () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const dataDirectory = join(root, "data");
    const directory = logFiles.ensureLogsDirectory(dataDirectory);
    const moved = `${directory}-moved`;
    const target = join(moved, "vllm_controller.log");
    fs.renameSync(directory, moved);
    fs.writeFileSync(target, "unchanged");
    fs.symlinkSync(moved, directory);
    expect(() => logFiles.openPrivateLogFile(join(directory, "vllm_controller.log"), true)).toThrow(
      "Unsafe log directory",
    );
    expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
  });

  test("does not follow a log-file symlink", async () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const target = join(root, "target.log");
    const dataDirectory = join(root, "data");
    const filePath = logFiles.primaryLogPathFor(dataDirectory, "controller");
    fs.writeFileSync(target, "unchanged");
    fs.symlinkSync(target, filePath);
    const original = console.info;
    console.info = () => {};
    try {
      const logger = createLogger("info", { filePath });
      logger.info(`OPENAI_API_KEY=${syntheticSecret}`);
      await Effect.runPromise(logger.shutdown());
    } finally {
      console.info = original;
    }
    expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
  });

  test("rejects or refuses to tail a log-file symlink", () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const target = join(root, "private.txt");
    const dataDirectory = join(root, "data");
    const sessionId = `symlink-${process.pid}-${Date.now()}`;
    const filePath = logFiles.primaryLogPathFor(dataDirectory, sessionId);
    fs.writeFileSync(target, syntheticSecret);
    fs.symlinkSync(target, filePath);
    expect(() => logFiles.resolveExistingLogPath(dataDirectory, sessionId)).toThrow(
      "Unsafe log file",
    );
    expect(logFiles.tailFileLines(filePath, 10)).toEqual([]);
  });

  test("installer establishes private modes before creating credentials", () => {
    const installer = fs.readFileSync(
      fileURLToPath(new URL("../../scripts/install-controller.sh", import.meta.url)),
      "utf8",
    );
    const umaskAt = installer.indexOf("umask 077");
    const earlyEnvModeAt = installer.indexOf('harden_private_file "$ENV_FILE"');
    const earlyLogModeAt = installer.indexOf('harden_private_file "$DATA_DIR/controller.log"');
    const sourceUpdateAt = installer.indexOf('git -C "$DIR" pull');
    const dependencyInstallAt = installer.indexOf('"$BUN" install');
    const credentialAt = installer.indexOf("openssl rand -hex 32");
    const launchdUmaskAt = installer.indexOf("<key>Umask</key><integer>63</integer>");
    const launchdOutputAt = installer.indexOf("<key>StandardOutPath</key>");
    expect(umaskAt).toBeGreaterThan(0);
    expect(earlyEnvModeAt).toBeGreaterThan(umaskAt);
    expect(earlyLogModeAt).toBeGreaterThan(earlyEnvModeAt);
    expect(sourceUpdateAt).toBeGreaterThan(earlyLogModeAt);
    expect(dependencyInstallAt).toBeGreaterThan(sourceUpdateAt);
    expect(credentialAt).toBeGreaterThan(umaskAt);
    expect(launchdUmaskAt).toBeGreaterThan(credentialAt);
    expect(launchdOutputAt).toBeGreaterThan(launchdUmaskAt);
    expect(installer).toContain('chmod 600 "$ENV_FILE"');
    expect(installer).toContain('chmod 600 "$DATA_DIR/controller.log"');
    expect(installer).toContain("UMask=0077");
  });
});
