import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AppContext } from "../src/app-context";
import type { Config } from "../src/config/env";
import { isHttpStatus } from "../src/core/errors";
import {
  controllerRuntimeMiddleware,
  type ControllerEnvironment,
} from "../src/http/effect-handler";
import { registerStudioRoutes } from "../src/modules/studio/routes";
import { registerExperimentTrackingRoutes } from "../src/modules/workbench/experiment-routes";
import { ExperimentTrackingStore } from "../src/modules/workbench/experiment-store";
import { ControllerSettingsStore } from "../src/stores/controller-settings-store";
import { ProviderSecretStore } from "../src/services/provider-secret-store";

const runtimes: Array<{ dispose: () => Promise<void> }> = [];
const experimentStores: ExperimentTrackingStore[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
  for (const store of experimentStores.splice(0)) await Effect.runPromise(store.close());
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const makeContext = (): { context: AppContext; dataDir: string; notebookRoot: string } => {
  const dataDir = mkdtempSync(join(tmpdir(), "scientist-e2e-"));
  tempDirs.push(dataDir);
  const notebookRoot = join(dataDir, "notebooks");
  mkdirSync(notebookRoot, { recursive: true });

  const experimentTrackingStore = new ExperimentTrackingStore(
    join(dataDir, "experiments.db"),
  );
  experimentStores.push(experimentTrackingStore);

  const controllerSettingsStore = new ControllerSettingsStore(
    join(dataDir, "settings.db"),
  );

  const providerSecretStore = new ProviderSecretStore(dataDir, false);

  const config: Config = {
    host: "127.0.0.1",
    port: 0,
    inference_host: "localhost",
    inference_port: 8000,
    data_dir: dataDir,
    db_path: join(dataDir, "controller.db"),
    models_dir: join(dataDir, "models"),
    strict_openai_models: false,
    providers: [],
    notebook_root: notebookRoot,
    notebook_python: "python3",
    notebook_smolvm: "smolvm",
    notebook_node_image: join(dataDir, "node-image.tar"),
    notebook_python_image: join(dataDir, "python-image.tar"),
  };

  const noop = () => {};
  const stubStore = { listEffect: () => Effect.succeed([]) };

  const context = {
    config,
    logger: { info: noop, warn: noop, error: noop, debug: noop, child: () => ({ info: noop, warn: noop, error: noop, debug: noop }) },
    eventManager: { publish: noop, subscribe: () => ({ unsubscribe: noop }) },
    providerSecretStore,
    stores: {
      experimentTrackingStore,
      controllerSettingsStore,
      rigStore: stubStore,
      recipeStore: stubStore,
      downloadStore: stubStore,
      peakMetricsStore: stubStore,
      lifetimeMetricsStore: stubStore,
      inferenceRequestStore: stubStore,
      controllerRequestStore: stubStore,
      scientificWorkbenchStore: { close: () => Effect.succeed(undefined) },
    },
  } as unknown as AppContext;

  return { context, dataDir, notebookRoot };
};

const makeApp = (context: AppContext) => {
  const runtime = ManagedRuntime.make(Layer.empty) as unknown as {
    dispose: () => Promise<void>;
  };
  runtimes.push(runtime);
  const app = new Hono<ControllerEnvironment>();
  app.use("*", controllerRuntimeMiddleware(runtime as never));
  registerStudioRoutes(app, context);
  registerExperimentTrackingRoutes(app, context);
  app.onError((error, ctx) =>
    isHttpStatus(error)
      ? ctx.json({ detail: error.detail }, error.status as 400 | 403 | 404 | 500)
      : ctx.json({ detail: "Internal Server Error" }, 500),
  );
  return app;
};

const request = (
  app: Hono<ControllerEnvironment>,
  path: string,
  init: RequestInit = {},
) =>
  app.fetch(
    new Request(`http://127.0.0.1${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    }),
  );

const jsonBody = (data: unknown) => JSON.stringify(data);

describe("Scientist onboarding end-to-end", () => {
  test("mode picker → intake → profile persisted → template → project created → experiment tracked", async () => {
    const { context, notebookRoot } = makeContext();
    const app = makeApp(context);

    // ── Step 1: Settings expose notebook_root ──────────────────────────
    const settingsRes = await request(app, "/studio/settings");
    expect(settingsRes.status).toBe(200);
    const settings = (await settingsRes.json()) as { notebook_root: string };
    expect(settings.notebook_root).toBe(notebookRoot);

    // ── Step 2: Scientist profile starts empty ─────────────────────────
    const emptyProfileRes = await request(app, "/studio/scientist-profile");
    expect(emptyProfileRes.status).toBe(200);
    expect((await emptyProfileRes.json()) as { profile: unknown }).toEqual({
      profile: null,
    });

    // ── Step 3: Save scientist profile (intake form submit) ────────────
    const profilePayload = {
      research_field: "biology",
      specialization: "Bioinformatics",
      data_types: ["text", "genomic"],
      goals: ["literature_review", "data_analysis", "experiment_pipeline"],
      compute_preference: "local-smolvm",
      experience_level: "some_code",
      process_steps: [
        { id: "s1", label: "Load data", step_type: "data_collection", order: 1 },
        { id: "s2", label: "Clean data", step_type: "data_cleaning", order: 2 },
        { id: "s3", label: "Analyze", step_type: "analysis", order: 3 },
      ],
    };
    const saveProfileRes = await request(app, "/studio/scientist-profile", {
      method: "PUT",
      body: jsonBody(profilePayload),
    });
    expect(saveProfileRes.status).toBe(200);
    const savedProfile = (await saveProfileRes.json()) as {
      profile: { research_field: string; specialization: string; created_at: string };
    };
    expect(savedProfile.profile.research_field).toBe("biology");
    expect(savedProfile.profile.specialization).toBe("Bioinformatics");
    expect(savedProfile.profile.created_at).toBeTruthy();

    // ── Step 4: Retrieve profile — persists across requests ────────────
    const getProfileRes = await request(app, "/studio/scientist-profile");
    expect(getProfileRes.status).toBe(200);
    const retrieved = (await getProfileRes.json()) as {
      profile: { research_field: string; goals: string[]; process_steps: unknown[] };
    };
    expect(retrieved.profile.research_field).toBe("biology");
    expect(retrieved.profile.goals).toContain("experiment_pipeline");
    expect(retrieved.profile.process_steps).toHaveLength(3);

    // ── Step 5: List project templates ─────────────────────────────────
    const templatesRes = await request(app, "/studio/project-templates");
    expect(templatesRes.status).toBe(200);
    const { templates } = (await templatesRes.json()) as {
      templates: Array<{ id: string; name: string; notebook_cells: unknown[] }>;
    };
    expect(templates.length).toBeGreaterThanOrEqual(3);
    const templateIds = templates.map((t) => t.id);
    expect(templateIds).toContain("literature-review");
    expect(templateIds).toContain("data-analysis");
    expect(templateIds).toContain("experiment-pipeline");

    // ── Step 6: Materialize a template (project creation) ──────────────
    // Use no project_path — should default to notebook_root/template_name
    const materializeRes = await request(
      app,
      "/studio/project-templates/experiment-pipeline/materialize",
      { method: "POST", body: jsonBody({}) },
    );
    expect(materializeRes.status).toBe(200);
    const materialized = (await materializeRes.json()) as {
      project_path: string;
      notebook_path: string;
      agent_context_path: string;
      template_id: string;
      template_name: string;
    };
    expect(materialized.template_id).toBe("experiment-pipeline");
    expect(materialized.template_name).toBe("Experiment Pipeline");
    expect(materialized.project_path).toBe(join(notebookRoot, "Experiment Pipeline"));

    // Verify files exist on disk
    expect(existsSync(materialized.notebook_path)).toBe(true);
    expect(existsSync(materialized.agent_context_path)).toBe(true);

    // Verify notebook is valid nbformat 4 with content from the template
    const notebook = JSON.parse(
      readFileSync(materialized.notebook_path, "utf8"),
    ) as { nbformat: number; cells: Array<{ cell_type: string; source: string[] }> };
    expect(notebook.nbformat).toBe(4);
    expect(notebook.cells.length).toBeGreaterThan(0);
    const firstCellSource = notebook.cells[0]?.source.join("") ?? "";
    expect(firstCellSource).toContain("Experiment Pipeline");

    // Verify agent context has the template's prompt
    const agentContext = readFileSync(materialized.agent_context_path, "utf8");
    expect(agentContext).toContain("experiment pipeline assistant");

    // ── Step 7: Create a custom project via process-expression flow ────
    const customProjectName = "My Climate Analysis";
    const customCells = [
      { cell_type: "markdown" as const, source: "# My Climate Analysis\n\nGenerated from workflow." },
      { cell_type: "markdown" as const, source: "## Step: Load temperature data" },
      { cell_type: "code" as const, source: "import pandas as pd\ndf = pd.read_csv('temp.csv')" },
      { cell_type: "markdown" as const, source: "## Step: Analyze trends" },
      { cell_type: "code" as const, source: "from scipy import stats\nresult = stats.linregress(df['year'], df['temp'])" },
    ];
    const customAgentPrompt = "You are a research assistant for My Climate Analysis.\nThe workflow: 1. Load temperature data 2. Analyze trends.";

    const customRes = await request(app, "/studio/projects/custom", {
      method: "POST",
      body: jsonBody({
        project_name: customProjectName,
        notebook_cells: customCells,
        agent_prompt: customAgentPrompt,
      }),
    });
    expect(customRes.status).toBe(200);
    const customProject = (await customRes.json()) as {
      project_path: string;
      notebook_path: string;
      agent_context_path: string;
      template_id: string;
      template_name: string;
    };
    expect(customProject.template_id).toBe("custom");
    expect(customProject.template_name).toBe(customProjectName);
    expect(customProject.project_path).toBe(join(notebookRoot, customProjectName));

    // Verify the custom notebook contains the user's actual workflow steps
    const customNotebook = JSON.parse(
      readFileSync(customProject.notebook_path, "utf8"),
    ) as { cells: Array<{ cell_type: string; source: string[] }> };
    const customSources = customNotebook.cells.map((c) => c.source.join(""));
    expect(customSources.some((s) => s.includes("Load temperature data"))).toBe(true);
    expect(customSources.some((s) => s.includes("Analyze trends"))).toBe(true);
    expect(customSources.some((s) => s.includes("linregress"))).toBe(true);

    // Verify agent context has the custom prompt
    const customAgentContext = readFileSync(customProject.agent_context_path, "utf8");
    expect(customAgentContext).toContain("My Climate Analysis");
    expect(customAgentContext).toContain("Load temperature data");

    // ── Step 8: Create an experiment for the custom project ────────────
    const projectId = customProject.project_path;
    const createExpRes = await request(app, "/experiments", {
      method: "POST",
      body: jsonBody({
        project_id: projectId,
        name: "Linear regression baseline",
        parameters: { learning_rate: 0.001, batch_size: 32 },
        notes: "First run with default parameters",
      }),
    });
    expect(createExpRes.status).toBe(201);
    const { experiment } = (await createExpRes.json()) as {
      experiment: {
        id: string;
        project_id: string;
        name: string;
        status: string;
        parameters: Record<string, unknown>;
        metrics: Record<string, unknown>;
        artifacts: unknown[];
      };
    };
    expect(experiment.id).toBeTruthy();
    expect(experiment.project_id).toBe(projectId);
    expect(experiment.name).toBe("Linear regression baseline");
    expect(experiment.status).toBe("running");
    expect(experiment.parameters).toEqual({ learning_rate: 0.001, batch_size: 32 });
    expect(experiment.metrics).toEqual({});
    expect(experiment.artifacts).toEqual([]);

    // ── Step 9: Update experiment with results (succeeded) ─────────────
    const updateRes = await request(app, `/experiments/${experiment.id}`, {
      method: "PATCH",
      body: jsonBody({
        status: "succeeded",
        metrics: { r_squared: 0.87, mse: 0.043, slope: 0.015 },
        artifacts: [
          { name: "regression_plot.png", kind: "plot", path: "experiments/regression_plot.png" },
          { name: "model_coefficients.json", kind: "data", path: "experiments/coeffs.json" },
        ],
        completed_at: new Date().toISOString(),
      }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as {
      experiment: {
        id: string;
        status: string;
        metrics: Record<string, number>;
        artifacts: Array<{ name: string; kind: string }>;
        completed_at: string;
      };
    };
    expect(updated.experiment.status).toBe("succeeded");
    expect(updated.experiment.metrics["r_squared"]).toBe(0.87);
    expect(updated.experiment.metrics["mse"]).toBe(0.043);
    expect(updated.experiment.artifacts).toHaveLength(2);
    expect(updated.experiment.artifacts[0]?.name).toBe("regression_plot.png");
    expect(updated.experiment.completed_at).toBeTruthy();

    // ── Step 10: Create a child experiment (lineage tracking) ──────────
    const childExpRes = await request(app, "/experiments", {
      method: "POST",
      body: jsonBody({
        project_id: projectId,
        name: "Tuned regression",
        parameters: { learning_rate: 0.01, batch_size: 64 },
        parent_experiment_id: experiment.id,
        notes: "Tuned hyperparameters based on baseline",
      }),
    });
    expect(childExpRes.status).toBe(201);
    const { experiment: childExp } = (await childExpRes.json()) as {
      experiment: { id: string; parent_experiment_id: string };
    };
    expect(childExp.parent_experiment_id).toBe(experiment.id);

    // ── Step 11: Retrieve lineage ──────────────────────────────────────
    const lineageRes = await request(app, `/experiments/${childExp.id}/lineage`);
    expect(lineageRes.status).toBe(200);
    const { lineage } = (await lineageRes.json()) as {
      lineage: Array<{ id: string; name: string }>;
    };
    expect(lineage).toHaveLength(2);
    expect(lineage[0]?.id).toBe(experiment.id);
    expect(lineage[0]?.name).toBe("Linear regression baseline");
    expect(lineage[1]?.id).toBe(childExp.id);
    expect(lineage[1]?.name).toBe("Tuned regression");

    // ── Step 12: List experiments for the project ──────────────────────
    const listRes = await request(
      app,
      `/experiments?project_id=${encodeURIComponent(projectId)}`,
    );
    expect(listRes.status).toBe(200);
    const { experiments } = (await listRes.json()) as {
      experiments: Array<{ id: string; name: string; status: string }>;
    };
    expect(experiments).toHaveLength(2);
    const experimentNames = experiments.map((e) => e.name);
    expect(experimentNames).toContain("Linear regression baseline");
    expect(experimentNames).toContain("Tuned regression");

    // ── Step 13: Get a single experiment ───────────────────────────────
    const getExpRes = await request(app, `/experiments/${experiment.id}`);
    expect(getExpRes.status).toBe(200);
    const { experiment: fetchedExp } = (await getExpRes.json()) as {
      experiment: { id: string; status: string; metrics: { r_squared: number } };
    };
    expect(fetchedExp.id).toBe(experiment.id);
    expect(fetchedExp.status).toBe("succeeded");
    expect(fetchedExp.metrics["r_squared"]).toBe(0.87);

    // ── Step 14: Delete the child experiment ───────────────────────────
    const deleteRes = await request(app, `/experiments/${childExp.id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
    expect((await deleteRes.json()) as { success: boolean }).toEqual({ success: true });

    // Verify it's gone
    const getDeletedRes = await request(app, `/experiments/${childExp.id}`);
    expect(getDeletedRes.status).toBe(404);

    // ── Step 15: Verify project directory structure on disk ────────────
    const projectDir = customProject.project_path;
    expect(statSync(projectDir).isDirectory()).toBe(true);
    expect(statSync(join(projectDir, "notebook.ipynb")).isFile()).toBe(true);
    expect(statSync(join(projectDir, ".agent-context.md")).isFile()).toBe(true);

    // Template project should also exist
    const templateProjectDir = materialized.project_path;
    expect(statSync(templateProjectDir).isDirectory()).toBe(true);
    expect(statSync(join(templateProjectDir, "notebook.ipynb")).isFile()).toBe(true);
  });

  test("custom project with explicit path creates at the specified location", async () => {
    const { context, dataDir } = makeContext();
    const app = makeApp(context);

    const explicitPath = join(dataDir, "custom-location");
    const res = await request(app, "/studio/projects/custom", {
      method: "POST",
      body: jsonBody({
        project_name: "Explicit Path Project",
        project_path: explicitPath,
        notebook_cells: [
          { cell_type: "markdown", source: "# Explicit" },
          { cell_type: "code", source: "print('hello')" },
        ],
        agent_prompt: "You are a helper.",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project_path: string };
    expect(body.project_path).toBe(resolve(explicitPath));
    expect(existsSync(join(body.project_path, "notebook.ipynb"))).toBe(true);
  });

  test("materialize template with explicit path creates at the specified location", async () => {
    const { context, dataDir } = makeContext();
    const app = makeApp(context);

    const explicitPath = join(dataDir, "template-location");
    const res = await request(
      app,
      "/studio/project-templates/data-analysis/materialize",
      {
        method: "POST",
        body: jsonBody({ project_path: explicitPath }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      project_path: string;
      template_id: string;
      notebook_path: string;
    };
    expect(body.template_id).toBe("data-analysis");
    expect(body.project_path).toBe(resolve(explicitPath));
    expect(existsSync(body.notebook_path)).toBe(true);
  });

  test("custom project rejects empty notebook cells", async () => {
    const { context } = makeContext();
    const app = makeApp(context);

    const res = await request(app, "/studio/projects/custom", {
      method: "POST",
      body: jsonBody({
        project_name: "Empty",
        notebook_cells: [],
        agent_prompt: "You are a helper.",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("materialize non-existent template returns 404", async () => {
    const { context } = makeContext();
    const app = makeApp(context);

    const res = await request(
      app,
      "/studio/project-templates/nonexistent/materialize",
      { method: "POST", body: jsonBody({}) },
    );
    expect(res.status).toBe(404);
  });

  test("experiment update on non-existent experiment returns 404", async () => {
    const { context } = makeContext();
    const app = makeApp(context);

    const res = await request(app, "/experiments/nonexistent-id", {
      method: "PATCH",
      body: jsonBody({ status: "succeeded" }),
    });
    expect(res.status).toBe(404);
  });

  test("experiment create rejects empty name", async () => {
    const { context } = makeContext();
    const app = makeApp(context);

    const res = await request(app, "/experiments", {
      method: "POST",
      body: jsonBody({ project_id: "proj-1", name: "" }),
    });
    expect(res.status).toBe(400);
  });
});
