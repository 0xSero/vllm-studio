import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Effect } from "effect";
import {
  applyRuntimeEnvInjections,
  buildAgentSessionOptions,
} from "../src/features/agent/pi-runtime-helpers";

const requestEffect = <T>(load: () => Promise<T>): Effect.Effect<T, unknown> =>
  Effect.tryPromise({ try: load, catch: (error) => error });

test("buildAgentSessionOptions resolves SDK extensions, skills, and env injections", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const root = yield* requestEffect(() => mkdtemp(path.join(tmpdir(), "pi-runtime-options-")));
      const timeoutExtension = path.join(root, "timeout.mjs");
      const agentPolicyExtension = path.join(root, "agent-policy.mjs");
      const browserExtension = path.join(root, "browser.mjs");
      const sitegeistExtension = path.join(root, "sitegeist-browser.mjs");
      const canvasExtension = path.join(root, "canvas.mjs");
      const planExtension = path.join(root, "plan.mjs");
      const selectedSkill = path.join(root, "selected-skill");
      const browserSkill = path.join(root, "browser-skill");
      const sitegeistSkill = path.join(root, "sitegeist-browser-skill");
      const canvasSkill = path.join(root, "canvas-skill");
      const planSkill = path.join(root, "plan-skill");
      const relayEnv = path.join(root, "sitegeist-relay.env");

      yield* Effect.all([
        requestEffect(() => mkdir(selectedSkill)),
        requestEffect(() => mkdir(browserSkill)),
        requestEffect(() => mkdir(sitegeistSkill)),
        requestEffect(() => mkdir(canvasSkill)),
        requestEffect(() => mkdir(planSkill)),
      ]);
      yield* Effect.all(
        [
          timeoutExtension,
          agentPolicyExtension,
          browserExtension,
          sitegeistExtension,
          canvasExtension,
          planExtension,
        ].map((filePath) =>
          requestEffect(() =>
            writeFile(filePath, "export default function extensionFactory() {}\n", "utf8"),
          ),
        ),
      );
      yield* requestEffect(() =>
        writeFile(
          relayEnv,
          "SITEGEIST_RELAY_URL=http://127.0.0.1:7717\nSITEGEIST_RELAY_TOKEN=test-token\n",
          "utf8",
        ),
      );

      const previousEnv = {
        LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH: process.env.LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH,
        LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH:
          process.env.LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH,
        LOCAL_STUDIO_BROWSER_EXTENSION_PATH: process.env.LOCAL_STUDIO_BROWSER_EXTENSION_PATH,
        LOCAL_STUDIO_SITEGEIST_BROWSER_EXTENSION_PATH:
          process.env.LOCAL_STUDIO_SITEGEIST_BROWSER_EXTENSION_PATH,
        LOCAL_STUDIO_CANVAS_EXTENSION_PATH: process.env.LOCAL_STUDIO_CANVAS_EXTENSION_PATH,
        LOCAL_STUDIO_PLAN_EXTENSION_PATH: process.env.LOCAL_STUDIO_PLAN_EXTENSION_PATH,
        LOCAL_STUDIO_BROWSER_SKILL_PATH: process.env.LOCAL_STUDIO_BROWSER_SKILL_PATH,
        LOCAL_STUDIO_SITEGEIST_BROWSER_SKILL_PATH:
          process.env.LOCAL_STUDIO_SITEGEIST_BROWSER_SKILL_PATH,
        LOCAL_STUDIO_CANVAS_SKILL_PATH: process.env.LOCAL_STUDIO_CANVAS_SKILL_PATH,
        LOCAL_STUDIO_PLAN_SKILL_PATH: process.env.LOCAL_STUDIO_PLAN_SKILL_PATH,
        LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH: process.env.LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH,
      };
      Object.assign(process.env, {
        LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH: timeoutExtension,
        LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH: agentPolicyExtension,
        LOCAL_STUDIO_BROWSER_EXTENSION_PATH: browserExtension,
        LOCAL_STUDIO_SITEGEIST_BROWSER_EXTENSION_PATH: sitegeistExtension,
        LOCAL_STUDIO_CANVAS_EXTENSION_PATH: canvasExtension,
        LOCAL_STUDIO_PLAN_EXTENSION_PATH: planExtension,
        LOCAL_STUDIO_BROWSER_SKILL_PATH: browserSkill,
        LOCAL_STUDIO_SITEGEIST_BROWSER_SKILL_PATH: sitegeistSkill,
        LOCAL_STUDIO_CANVAS_SKILL_PATH: canvasSkill,
        LOCAL_STUDIO_PLAN_SKILL_PATH: planSkill,
        LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH: relayEnv,
      });

      yield* Effect.gen(function* () {
        const result = yield* requestEffect(() =>
          buildAgentSessionOptions({
            options: {
              browserToolEnabled: true,
              browserSessionId: "browser-session",
              canvasEnabled: true,
              skills: [
                { name: "selected", path: selectedSkill },
                { name: "dupe", path: selectedSkill },
              ],
            },
            processEnv: { ...process.env, PORT: "3007" },
          }),
        );

        assert.equal(result.extensionPaths.length, 5);
        assert.deepEqual(result.extensionPaths.toSorted(), [
          agentPolicyExtension,
          browserExtension,
          canvasExtension,
          planExtension,
          timeoutExtension,
        ]);
        assert.deepEqual(result.skills, [selectedSkill, browserSkill, planSkill, canvasSkill]);
        assert.equal(result.envInjections.LOCAL_STUDIO_BROWSER_SESSION_ID, "browser-session");
        assert.equal(result.envInjections.LOCAL_STUDIO_FRONTEND_BASE, "http://127.0.0.1:3007");

        const targetEnv = {} as NodeJS.ProcessEnv;
        applyRuntimeEnvInjections(result.envInjections, targetEnv);
        assert.equal(targetEnv.SITEGEIST_RELAY_SESSION_ID, "browser-session");

        const sitegeistResult = yield* requestEffect(() =>
          buildAgentSessionOptions({
            options: {
              browserToolEnabled: true,
              browserBackend: "sitegeist",
              browserSessionId: "sitegeist-session",
            },
            processEnv: { ...process.env },
          }),
        );
        assert.deepEqual(sitegeistResult.extensionPaths.toSorted(), [
          agentPolicyExtension,
          planExtension,
          sitegeistExtension,
          timeoutExtension,
        ]);
        assert.deepEqual(sitegeistResult.skills, [sitegeistSkill, planSkill]);
        assert.equal(sitegeistResult.envInjections.SITEGEIST_RELAY_SESSION_ID, "sitegeist-session");
        assert.equal(sitegeistResult.envInjections.SITEGEIST_RELAY_URL, "http://127.0.0.1:7717");
        assert.equal(sitegeistResult.envInjections.SITEGEIST_RELAY_TOKEN, "test-token");
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const [key, value] of Object.entries(previousEnv)) {
              if (value === undefined) delete process.env[key];
              else process.env[key] = value;
            }
          }),
        ),
      );
    }),
  ));
