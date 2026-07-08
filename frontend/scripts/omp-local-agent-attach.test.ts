import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";

import { attachModelToAgents } from "../src/features/settings/local-agents";
import { providerKeyForBaseUrl } from "../src/features/settings/local-agent-config-merge";
import {
  ompConfigCandidatePaths,
  resolveOmpConfigPath,
} from "../src/features/settings/local-agent-detection";
import type { LocalAgentModel } from "../src/features/settings/local-agent-types";

type ProviderEntry = {
  baseUrl: string;
  apiKey: string;
  api: string;
  models: Array<Record<string, unknown>>;
};

type ModelsConfig = {
  providers: Record<string, ProviderEntry>;
};

function model(patch: Partial<LocalAgentModel> = {}): LocalAgentModel {
  return {
    modelId: "qwen3-coder",
    displayName: "Qwen3 Coder",
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "sk-local",
    contextWindow: 262144,
    maxTokens: 32768,
    reasoning: false,
    images: false,
    ...patch,
  };
}

function tempHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "omp-attach-"));
}

async function makeOmpAgentDir(home: string): Promise<string> {
  const dir = path.join(home, ".omp", "agent");
  await mkdir(dir, { recursive: true });
  return dir;
}

test("attach to omp with an empty agent dir creates models.yml with the local-studio provider and one model entry", async () => {
  const home = await tempHome();
  await makeOmpAgentDir(home);
  const m = model({ images: true });

  const [result] = await attachModelToAgents({ home, targets: ["omp"], model: m });

  assert.equal(result.ok, true);
  assert.equal(result.action, "created-file");
  assert.equal(result.configPath, ompConfigCandidatePaths(home).yml);
  assert.equal(result.extraUpdates, undefined);

  const parsed = YAML.parse(
    await readFile(ompConfigCandidatePaths(home).yml, "utf-8"),
  ) as ModelsConfig;
  const provider = parsed.providers["local-studio"];
  assert.equal(provider.baseUrl, m.baseUrl);
  assert.equal(provider.apiKey, m.apiKey);
  assert.equal(provider.api, "openai-completions");
  assert.equal(provider.models.length, 1);

  const entry = provider.models[0];
  assert.equal(entry.id, m.modelId);
  assert.equal(entry.name, m.displayName);
  assert.equal(entry.contextWindow, m.contextWindow);
  assert.equal(entry.maxTokens, m.maxTokens);
  assert.deepEqual(entry.input, ["text", "image"]);
});

test("attach to omp with a yml provider matching the baseUrl appends then updates the model, preserving unrelated keys", async () => {
  const home = await tempHome();
  await makeOmpAgentDir(home);
  const ymlPath = ompConfigCandidatePaths(home).yml;
  const m = model();
  const seed = {
    theme: "dark",
    providers: {
      mylocal: {
        baseUrl: m.baseUrl,
        apiKey: "sk-old",
        api: "openai-completions",
        models: [{ id: "other-model", name: "Other" }],
      },
    },
  };
  await writeFile(ymlPath, YAML.stringify(seed), "utf-8");

  const [first] = await attachModelToAgents({ home, targets: ["omp"], model: m });
  assert.equal(first.ok, true);
  assert.equal(first.action, "added");
  assert.ok(first.backupPath);

  const afterAdd = YAML.parse(await readFile(ymlPath, "utf-8")) as ModelsConfig & { theme: string };
  assert.equal(afterAdd.theme, "dark");
  assert.equal(afterAdd.providers["local-studio"], undefined);
  const added = afterAdd.providers["mylocal"];
  assert.deepEqual(
    added.models.map((entry) => entry.id),
    ["other-model", m.modelId],
  );

  const [second] = await attachModelToAgents({
    home,
    targets: ["omp"],
    model: model({ displayName: "Renamed" }),
  });
  assert.equal(second.action, "updated");

  const afterUpdate = YAML.parse(await readFile(ymlPath, "utf-8")) as ModelsConfig;
  const updatedModels = afterUpdate.providers["mylocal"].models;
  assert.equal(updatedModels.length, 2);
  const updated = updatedModels.find((entry) => entry.id === m.modelId);
  assert.equal(updated?.name, "Renamed");
});

test("attach to omp writes into models.json when only the json config exists", async () => {
  const home = await tempHome();
  await makeOmpAgentDir(home);
  const { yml, json } = ompConfigCandidatePaths(home);
  await writeFile(json, JSON.stringify({ providers: {} }), "utf-8");
  const m = model();

  const [result] = await attachModelToAgents({ home, targets: ["omp"], model: m });

  assert.equal(result.ok, true);
  assert.equal(result.action, "added");
  assert.equal(result.configPath, json);

  const parsed = JSON.parse(await readFile(json, "utf-8")) as ModelsConfig;
  assert.equal(parsed.providers["local-studio"].api, "openai-completions");
  assert.equal(parsed.providers["local-studio"].models[0].id, m.modelId);

  await assert.rejects(() => readFile(yml, "utf-8"));
});

test("attach to omp appends the provider/model selector to a non-empty enabledModels list in config.yml", async () => {
  const home = await tempHome();
  await makeOmpAgentDir(home);
  const configYml = path.join(home, ".omp", "agent", "config.yml");
  await writeFile(configYml, YAML.stringify({ enabledModels: ["openai/gpt-4"] }), "utf-8");
  const m = model();

  const [result] = await attachModelToAgents({ home, targets: ["omp"], model: m });

  assert.equal(result.ok, true);
  assert.equal(result.extraUpdates?.length, 1);
  assert.equal(result.extraUpdates?.[0].configPath, configYml);
  assert.ok(result.extraUpdates?.[0].backupPath);

  const parsed = YAML.parse(await readFile(configYml, "utf-8")) as { enabledModels: string[] };
  assert.deepEqual(parsed.enabledModels, ["openai/gpt-4", `local-studio/${m.modelId}`]);
});

test("attach to omp leaves config.yml untouched when the selector is already enabled", async () => {
  const home = await tempHome();
  await makeOmpAgentDir(home);
  const configYml = path.join(home, ".omp", "agent", "config.yml");
  const m = model();
  const original = YAML.stringify({ enabledModels: [`local-studio/${m.modelId}`, "openai/gpt-4"] });
  await writeFile(configYml, original, "utf-8");

  const [result] = await attachModelToAgents({ home, targets: ["omp"], model: m });

  assert.equal(result.ok, true);
  assert.equal(result.extraUpdates, undefined);
  assert.equal(await readFile(configYml, "utf-8"), original);
});

test("attach to omp leaves an empty enabledModels list untouched and reports no extra updates", async () => {
  const home = await tempHome();
  await makeOmpAgentDir(home);
  const configYml = path.join(home, ".omp", "agent", "config.yml");
  const original = YAML.stringify({ enabledModels: [] });
  await writeFile(configYml, original, "utf-8");

  const [result] = await attachModelToAgents({ home, targets: ["omp"], model: model() });

  assert.equal(result.extraUpdates, undefined);
  assert.equal(await readFile(configYml, "utf-8"), original);
});

test("attach to omp when ~/.omp is absent fails with a not-installed error", async () => {
  const home = await tempHome();

  const [result] = await attachModelToAgents({ home, targets: ["omp"], model: model() });

  assert.equal(result.ok, false);
  assert.equal(result.agent, "omp");
  assert.match(result.error ?? "", /not installed/);
});

test("resolveOmpConfigPath prefers an existing models.yml over models.json", async () => {
  const home = await tempHome();
  const { yml, json } = ompConfigCandidatePaths(home);
  await makeOmpAgentDir(home);

  await writeFile(json, "{}", "utf-8");
  assert.equal(await resolveOmpConfigPath(home), json);

  await writeFile(yml, "", "utf-8");
  assert.equal(await resolveOmpConfigPath(home), yml);
});

test("providerKeyForBaseUrl matches a provider by normalized baseUrl and returns null when absent", () => {
  const config = {
    providers: {
      alpha: { baseUrl: "https://api.example.com/v1/" },
      beta: { baseUrl: "http://127.0.0.1:8000/v1" },
    },
  };

  assert.equal(providerKeyForBaseUrl(config, "http://127.0.0.1:8000/v1"), "beta");
  assert.equal(providerKeyForBaseUrl(config, "https://api.example.com/v1"), "alpha");
  assert.equal(providerKeyForBaseUrl(config, "http://localhost:9999/v1"), null);
});
