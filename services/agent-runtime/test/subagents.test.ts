import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeCwdForPi } from "../src/sessions-store";
import { subagentReport, type SubagentRun } from "../src/subagents";
import { cleanTemps, tempDir } from "./test-fixtures";

afterAll(cleanTemps);
function transcript(piSessionId: string): string {
  const root = tempDir("subagents-");
  const agentDir = path.join(root, "pi-agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwd = path.join(root, "project");
  const sessionDir = path.join(agentDir, "sessions", encodeCwdForPi(cwd));
  mkdirSync(sessionDir, { recursive: true });
  const entries = [
    { type: "session", id: piSessionId, cwd },
    {
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "partial work" }] },
    },
    {
      type: "message",
      message: { role: "assistant", content: [], errorMessage: "Request was aborted" },
    },
  ];
  writeFileSync(
    path.join(sessionDir, `rollout_${piSessionId}.jsonl`),
    `${entries.map(JSON.stringify).join("\n")}\n`,
  );
  return cwd;
}
function run(status: SubagentRun["status"], piSessionId: string): SubagentRun {
  return {
    id: "run-1",
    parentPiSessionId: "parent-1",
    name: "smoke",
    task: "test task",
    piSessionId,
    runtimeSessionId: "subagent:parent-1:run-1",
    cwd: transcript(piSessionId),
    status,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

test("cancelled runs ignore transcript abort errors", () => {
  const report = subagentReport(run("cancelled", "01a02222-0000-7000-8000-000000000001"));
  expect(report.error).toBeNull();
  expect(report.text).toBe("partial work");
});

test("failed runs surface transcript errors", () => {
  const report = subagentReport(run("error", "01a02222-0000-7000-8000-000000000002"));
  expect(report.error).toBe("Request was aborted");
  expect(report.text).toBe("partial work");
});
