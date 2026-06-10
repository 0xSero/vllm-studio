#!/usr/bin/env node
// Enforces the frontend layering convention:
//   src/ui        — shared primitives only; never imports features or app code
//   src/features  — one folder per page-feature (recipes, discover, settings,
//                   usage, plugins, setup, logs, dashboard, ...); never imports app code
//   src/app       — thin route shells composing features; no _components trees
//   src/components — retired; must stay empty
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const srcRoot = join(projectRoot, "src");
// src/ui holds zero feature-coupled files; primitive purity has no exceptions.
const legacyPrimitivePurityFiles = new Set([]);
const retiredUiFeatureDirs = new Set([
  "recipes",
  "discover",
  "configs",
  "usage",
  "plugins",
  "setup",
  "logs",
  "dashboard",
]);
const sourceExtensions = new Set([".ts", ".tsx"]);

const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile()) inspectFile(fullPath);
  }
}

function inspectFile(filePath) {
  const rel = relative(srcRoot, filePath);
  const segments = rel.split(sep);

  if (segments[0] === "components") {
    findings.push({
      rule: "retired-components-dir",
      path: rel,
      detail: "src/components is retired; page features live in src/features, primitives in src/ui.",
    });
  }

  if (segments[0] === "ui" && segments.length > 2 && retiredUiFeatureDirs.has(segments[1])) {
    findings.push({
      rule: "feature-location",
      path: rel,
      detail: `Page-feature UI belongs in src/features/${segments[1]}; src/ui is for shared primitives.`,
    });
  }

  if (segments[0] === "app" && rel.includes(`${sep}_components${sep}`)) {
    findings.push({
      rule: "route-ui-location",
      path: rel,
      detail: "Route UI belongs in src/features/<name>; app routes stay thin shells.",
    });
  }

  const extension = filePath.slice(filePath.lastIndexOf("."));
  if (!sourceExtensions.has(extension)) return;

  const source = readFileSync(filePath, "utf8");

  for (const match of source.matchAll(/from\s+["']@\/components\/([^"']+)["']/g)) {
    findings.push({
      rule: "retired-components-import",
      path: rel,
      detail: `Import "@/components/${match[1]}" is retired; use "@/features/..." or "@/ui/...".`,
    });
  }

  if (segments[0] === "ui" && !legacyPrimitivePurityFiles.has(rel)) {
    for (const match of source.matchAll(/from\s+["']@\/(features|app)\/([^"']+)["']/g)) {
      findings.push({
        rule: "primitive-purity",
        path: rel,
        detail: `src/ui is the primitives layer and must not import "@/${match[1]}/${match[2]}".`,
      });
    }
  }

  if (segments[0] === "features") {
    for (const match of source.matchAll(/from\s+["']@\/app\/([^"']+)["']/g)) {
      findings.push({
        rule: "feature-app-import",
        path: rel,
        detail: `src/features must not import app code ("@/app/${match[1]}"); features are composed by routes, not the reverse.`,
      });
    }
  }
}

if (statSync(srcRoot, { throwIfNoEntry: false })) {
  walk(srcRoot);
}

if (findings.length > 0) {
  console.error("UI structure check failed:");
  for (const finding of findings) {
    console.error(`- ${finding.rule}: ${finding.path}`);
    console.error(`  ${finding.detail}`);
  }
  process.exit(1);
}

console.log("UI structure check passed");
