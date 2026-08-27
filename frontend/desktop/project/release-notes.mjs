import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const sinceIndex = args.indexOf("--since");
const rangeIndex = args.indexOf("--range");
const maxIndex = args.indexOf("--max");

const maxItems = Number(maxIndex === -1 ? 20 : args[maxIndex + 1]);
const range =
  rangeIndex === -1
    ? `--since=${sinceIndex === -1 ? "1 week ago" : args[sinceIndex + 1]}`
    : args[rangeIndex + 1];

const logArgs =
  rangeIndex === -1
    ? ["log", "origin/main", range, "--pretty=format:%s"]
    : ["log", range, "--pretty=format:%s"];

const output = execFileSync("git", logArgs, { encoding: "utf8" }).trim();
const subjects = output ? output.split(/\r?\n/) : [];

const groups = [
  { name: "Features", pattern: /^(feat)(?:\(.+\))?!?: (.+)$/ },
  { name: "Fixes", pattern: /^(fix)(?:\(.+\))?!?: (.+)$/ },
  { name: "Performance", pattern: /^(perf)(?:\(.+\))?!?: (.+)$/ },
  { name: "Refactors", pattern: /^(refactor)(?:\(.+\))?!?: (.+)$/ },
  { name: "Tests", pattern: /^(test)(?:\(.+\))?!?: (.+)$/ },
  { name: "Infrastructure", pattern: /^(build|ci|chore|release)(?:\(.+\))?!?: (.+)$/ },
  { name: "Polish", pattern: /^(micro|style)(?:\(.+\))?!?: (.+)$/ },
  { name: "Documentation", pattern: /^(docs)(?:\(.+\))?!?: (.+)$/ },
];

console.log("# Release Statement\n");
let emitted = 0;
for (const { name, pattern } of groups) {
  const items = subjects.flatMap((subject) => {
    const match = pattern.exec(subject);
    return match?.[2] ? [match[2]] : [];
  });
  if (items.length === 0 || emitted >= maxItems) continue;
  console.log(`## ${name}\n`);
  for (const item of items.slice(0, maxItems - emitted)) {
    console.log(`- ${item}`);
    emitted += 1;
  }
  console.log("");
}
