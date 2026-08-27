#!/usr/bin/env node
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterPack } from "./project/standalone.mjs";
import { repoRoot } from "./project/lib.mjs";

const commands = new Map([
  [
    "assert-release-main",
    () => import("./project/release.mjs").then(({ assertReleaseMain }) => assertReleaseMain()),
  ],
  [
    "assert-standalone",
    () => import("./project/standalone.mjs").then(({ assertStandalone }) => assertStandalone()),
  ],
  ["browser-perf", () => import("./project/browser-perf.mjs")],
  [
    "bundle-agent-runtime",
    () =>
      import("./project/agent-runtime.mjs").then(({ bundleAgentRuntime }) => bundleAgentRuntime()),
  ],
  [
    "check-commits",
    () => import("./project/commits.mjs").then(({ checkCommits }) => checkCommits()),
  ],
  [
    "complete-standalone",
    () => import("./project/standalone.mjs").then(({ completeStandalone }) => completeStandalone()),
  ],
  [
    "controller-standards",
    () => import("./project/validate.mjs").then(({ controllerStandards }) => controllerStandards()),
  ],
  ["doctor", () => import("./project/toolchain.mjs").then(({ doctor }) => doctor())],
  [
    "link-services",
    () => import("./project/toolchain.mjs").then(({ linkServices }) => linkServices()),
  ],
  ["perf", () => import("./project/perf.mjs")],
  [
    "postbuild-agent-runtime",
    () =>
      import("./project/agent-runtime.mjs").then(({ postbuildAgentRuntime }) =>
        postbuildAgentRuntime(),
      ),
  ],
  [
    "prepare-agent-runtime",
    () =>
      rmSync(path.join(repoRoot, "services", "agent-runtime", "dist"), {
        recursive: true,
        force: true,
      }),
  ],
  [
    "prepare-next",
    () => import("./project/standalone.mjs").then(({ prepareNext }) => prepareNext()),
  ],
  ["release-notes", () => import("./project/release-notes.mjs")],
  [
    "setup",
    () => import("./project/toolchain.mjs").then(({ setupRepository }) => setupRepository()),
  ],
  [
    "sign-release",
    () => import("./project/release.mjs").then(({ signDesktopRelease }) => signDesktopRelease()),
  ],
  [
    "stage-release",
    () => import("./project/release.mjs").then(({ stageDesktopRelease }) => stageDesktopRelease()),
  ],
  ["start", () => import("./project/start.mjs").then(({ start }) => start())],
  [
    "validate-contracts",
    () => import("./project/validate.mjs").then(({ validateContracts }) => validateContracts()),
  ],
  [
    "validate-package",
    () => import("./project/validate.mjs").then(({ validatePackage }) => validatePackage()),
  ],
  [
    "validate-structure",
    () => import("./project/validate.mjs").then(({ validateStructure }) => validateStructure()),
  ],
  ["validate-ui", () => import("./project/validate.mjs").then(({ validateUi }) => validateUi())],
  ["audit-layout", () => import("./project/validate.mjs").then(({ auditLayout }) => auditLayout())],
]);

const invoked = path.basename(process.argv[1] ?? "");
if (invoked === "commit-msg") {
  process.argv.splice(2, 0, "--message-file");
  const { checkCommits } = await import("./project/commits.mjs");
  checkCommits();
} else if (invoked === "pre-commit") {
  const { preCommit } = await import("./project/hooks.mjs");
  preCommit();
} else if (invoked === "pre-push") {
  const { prePush } = await import("./project/hooks.mjs");
  prePush();
} else if (
  invoked === "project.mjs" ||
  path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  const command = process.argv[2];
  process.argv.splice(2, 1);
  if (command === "setup-hooks") {
    const { setupHooks } = await import("./project/toolchain.mjs");
    setupHooks();
  } else if (!command || !commands.has(command)) {
    console.error(`Usage: node scripts/project.mjs <${[...commands.keys()].join("|")}>`);
    process.exit(1);
  } else {
    await commands.get(command)();
  }
}

export default afterPack;
