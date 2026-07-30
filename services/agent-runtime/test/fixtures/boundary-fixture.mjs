#!/usr/bin/env node
import fs from "node:fs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
if (process.env.BOUNDARY_FIXTURE_CAPTURE) {
  fs.writeFileSync(
    process.env.BOUNDARY_FIXTURE_CAPTURE,
    JSON.stringify({ argv: process.argv.slice(2), stdin: input }),
  );
}
process.stdout.write(JSON.stringify({ listen_port: 34567 }));
setInterval(() => undefined, 1_000);
