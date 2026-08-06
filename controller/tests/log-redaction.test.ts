import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import * as logFiles from "../src/core/log-files";
import { redactLogLine, redactLogTail } from "../src/core/log-redaction";
import { createLogger } from "../src/core/logger";

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
      `{"authorization":"Bearer ${syntheticSecret}"}`,
      `X-Api-Key: ${syntheticSecret}`,
      `OPENAI_API_KEY=${syntheticSecret}`,
      `{"api_key":"${syntheticSecret}"}`,
      `command --api-key=${syntheticSecret}`,
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

  test("does not resolve or tail a log-file symlink", () => {
    if (process.platform === "win32") return;
    const root = temporaryDirectory();
    const target = join(root, "private.txt");
    const dataDirectory = join(root, "data");
    const sessionId = `symlink-${process.pid}-${Date.now()}`;
    const filePath = logFiles.primaryLogPathFor(dataDirectory, sessionId);
    fs.writeFileSync(target, syntheticSecret);
    fs.symlinkSync(target, filePath);
    expect(logFiles.resolveExistingLogPath(dataDirectory, sessionId)).toBeNull();
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
    expect(umaskAt).toBeGreaterThan(0);
    expect(earlyEnvModeAt).toBeGreaterThan(umaskAt);
    expect(earlyLogModeAt).toBeGreaterThan(earlyEnvModeAt);
    expect(sourceUpdateAt).toBeGreaterThan(earlyLogModeAt);
    expect(dependencyInstallAt).toBeGreaterThan(sourceUpdateAt);
    expect(credentialAt).toBeGreaterThan(umaskAt);
    expect(installer).toContain('chmod 600 "$ENV_FILE"');
    expect(installer).toContain('chmod 600 "$DATA_DIR/controller.log"');
    expect(installer).toContain("UMask=0077");
  });
});
