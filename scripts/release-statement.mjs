#!/usr/bin/env node
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
  ["Features", /^(feat)(?:\(.+\))?!?: (.+)$/],
  ["Fixes", /^(fix)(?:\(.+\))?!?: (.+)$/],
  ["Performance", /^(perf)(?:\(.+\))?!?: (.+)$/],
  ["Refactors", /^(refactor)(?:\(.+\))?!?: (.+)$/],
  ["Tests", /^(test)(?:\(.+\))?!?: (.+)$/],
  ["Infrastructure", /^(build|ci|chore|release)(?:\(.+\))?!?: (.+)$/],
  ["Polish", /^(micro|style)(?:\(.+\))?!?: (.+)$/],
  ["Documentation", /^(docs)(?:\(.+\))?!?: (.+)$/],
];

const grouped = new Map(groups.map(([name]) => [name, []]));

for (const subject of subjects) {
  for (const [name, pattern] of groups) {
    const match = pattern.exec(subject);
    if (match) {
      grouped.get(name).push(match[2]);
      break;
    }
  }
}

console.log("# Release Statement\n");
let emitted = 0;

for (const [name, items] of grouped) {
  if (!items.length || emitted >= maxItems) {
    continue;
  }

  console.log(`## ${name}\n`);
  for (const item of items.slice(0, maxItems - emitted)) {
    console.log(`- ${item}`);
    emitted += 1;
  }
  console.log("");
}

if (emitted === 0) {
  console.log("- No conventional release changes found for the selected range.");
}
