#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
if (process.env.REMOTE_FIXTURE_CAPTURE) {
  fs.writeFileSync(
    process.env.REMOTE_FIXTURE_CAPTURE,
    JSON.stringify({ argv: process.argv.slice(2), stdin: input }),
  );
}
if (process.env.REMOTE_FIXTURE_MODE === "host-key") {
  process.stderr.write("Host key verification failed.\n");
  process.exit(255);
}
if (process.env.REMOTE_FIXTURE_MODE === "passthrough") {
  const index = process.argv.indexOf("python3");
  const result = spawnSync(process.argv[index], process.argv.slice(index + 1), {
    input,
    encoding: "utf8",
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const value = JSON.parse(input);
if (value.op === "inspect") {
  process.stdout.write(
    JSON.stringify({ releaseId: null, releaseDigest: null, agentDigests: {}, services: {} }),
  );
} else if (value.op === "stage") {
  process.stdout.write(
    JSON.stringify({
      path: value.path,
      digest: process.env.REMOTE_FIXTURE_DIGEST,
      previousRelease: null,
    }),
  );
} else if (value.op === "config") {
  process.stdout.write(
    JSON.stringify({
      path: value.path,
      operation: "created",
      afterDigest: process.env.REMOTE_FIXTURE_DIGEST,
    }),
  );
} else {
  process.stdout.write("{}");
}
