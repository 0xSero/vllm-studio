import { cpus } from "node:os";
import { Effect, Schema } from "effect";
import {
  REGISTRY_BASE_BRANCH,
  REGISTRY_REPO,
  type RegistryHardware,
  type SchemaIssue,
  type ShareFile,
  type SharePreviewPayload,
  type SharePullRequestResult,
} from "@local-studio/contracts/registry";
import type { ModelDownload } from "@local-studio/contracts/recipes";
import type { GpuInfo, Recipe } from "../models/types";
import type { HostProfile } from "../compute/contracts";
import type { ComputeLaunchInput } from "../compute/lifecycle";
import { planLaunch } from "../compute/engines/registry";
import { getGpuInfo } from "../system/platform/gpu";
import { estimateWeightsSizeBytes } from "../models/model-browser";
import { detectedAppleSilicon, detectedFromGpus, matchAccelerators } from "./hardware-match";
import {
  buildContribution,
  modelNameFromRepository,
  type Contribution,
  type LaunchEvidence,
  type MeasuredPeaks,
} from "./serialize";
import { collectRedactionSecrets, redactRecord } from "./redact";
import { validateAgainstRegistrySchema } from "./validate";
import { makeGitHubClient, type GitHubClient, type GitHubError } from "./github";
import { makeRegistryClient, type RegistryClient, type RegistryClientError } from "./client";

export const SHARE_PR_NOTICE = `This will create a PR to https://github.com/${REGISTRY_REPO}`;

export class ShareRecipeMissing extends Schema.TaggedErrorClass<ShareRecipeMissing>()(
  "ShareRecipeMissing",
  { recipeId: Schema.String },
) {}

export class ShareConfirmationRequired extends Schema.TaggedErrorClass<ShareConfirmationRequired>()(
  "ShareConfirmationRequired",
  { message: Schema.String },
) {}

export class ShareNotValid extends Schema.TaggedErrorClass<ShareNotValid>()("ShareNotValid", {
  message: Schema.String,
  issues: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
}) {}

export class ShareUnavailable extends Schema.TaggedErrorClass<ShareUnavailable>()(
  "ShareUnavailable",
  { message: Schema.String },
) {}

export class ShareFailed extends Schema.TaggedErrorClass<ShareFailed>()("ShareFailed", {
  step: Schema.String,
  message: Schema.String,
}) {}

export type ShareError =
  | ShareRecipeMissing
  | ShareConfirmationRequired
  | ShareNotValid
  | ShareUnavailable
  | ShareFailed;

export interface ShareService {
  readonly preview: (recipeId: string) => Effect.Effect<SharePreviewPayload, ShareError>;
  readonly createPullRequest: (
    recipeId: string,
    confirm: boolean,
  ) => Effect.Effect<SharePullRequestResult, ShareError>;
}

export interface ShareDependencies {
  readonly getRecipe: (recipeId: string) => Effect.Effect<Recipe | null, unknown>;
  readonly isRunning: (recipeId: string) => Effect.Effect<boolean, unknown>;
  readonly peaks: (modelKey: string) => Effect.Effect<Record<string, unknown> | null, unknown>;
  readonly revisionFor: (modelPath: string) => Effect.Effect<string | null, unknown>;
  readonly gpus: () => Effect.Effect<GpuInfo[], unknown>;
  readonly host: () => Effect.Effect<HostProfile, unknown>;
  readonly launchInput: (recipe: Recipe) => Effect.Effect<ComputeLaunchInput, unknown>;
  readonly sizeBytes: (modelPath: string) => Effect.Effect<number | null, unknown>;
  readonly engineVersion: (port: number) => Effect.Effect<string | null, unknown>;
  readonly registry: RegistryClient;
  readonly github: Pick<
    GitHubClient,
    "getRepo" | "getBranch" | "createFork" | "createBranch" | "putFile" | "createPull"
  >;
  readonly inferencePort: number;
  readonly nowIso: () => string;
}

const HEAD_BRANCH_PREFIX = "share/local-studio";
const [REGISTRY_OWNER, REGISTRY_NAME] = REGISTRY_REPO.split("/");

/**
 * Demo/showcase override: share a configuration that has not run on this
 * machine. Records are flagged `unmeasured` and the PR body discloses it, so
 * an unmeasured contribution can never masquerade as evidence.
 */
const allowUnmeasured = (): boolean => {
  const value = process.env["LOCAL_AI_REGISTRY_ALLOW_UNMEASURED"]?.trim().toLowerCase();
  return value === "1" || value === "true";
};

export const makeShareService = (deps: ShareDependencies): ShareService => {
  const bypass = allowUnmeasured();
  const hardwareCollection = (): Effect.Effect<RegistryHardware[], RegistryClientError> =>
    deps.registry.index().pipe(
      Effect.flatMap((index) =>
        Effect.forEach(index.collections["hardware"] ?? [], (id) => deps.registry.hardware(id), {
          concurrency: 8,
        }),
      ),
    );

  const matchedHardware = (): Effect.Effect<
    RegistryHardware | null,
    RegistryClientError
  > =>
    Effect.gen(function* () {
      const [gpus, registry] = yield* Effect.all([
        deps.gpus().pipe(Effect.orElseSucceed(() => [] as GpuInfo[])),
        hardwareCollection(),
      ]);
      // os.cpus() reports the chip ("Apple M4 Pro") on Apple Silicon, which is
      // the hardware identity the registry's apple-* records are keyed on.
      const apple = detectedAppleSilicon(cpus()[0]?.model ?? null);
      const detected = [...detectedFromGpus(gpus), ...apple];
      const matches = matchAccelerators(detected, registry);
      const best = matches
        .filter((match) => match.matched)
        .sort(
          (a, b) => b.detected_count - a.detected_count || a.hardware_id.localeCompare(b.hardware_id),
        )[0];
      return best ? registry.find((entry) => entry.id === best.hardware_id) ?? null : null;
    });

  const measuredPeaks = (recipe: Recipe): Effect.Effect<MeasuredPeaks | null> =>
    deps
      .peaks(recipe.served_model_name ?? recipe.model_path.split("/").pop() ?? recipe.id)
      .pipe(Effect.orElseSucceed(() => null))
      .pipe(
        Effect.map((row) => {
          const generation = Number(row?.["generation_tps"] ?? 0);
          const prompt = Number(row?.["prefill_tps"] ?? 0);
          const ttft = Number(row?.["ttft_ms"] ?? 0);
          const measuredAt = typeof row?.["updated_at"] === "string" ? row["updated_at"] : null;
          if (generation <= 0 && prompt <= 0) return null;
          return {
            generation_tps: generation,
            prompt_tps: prompt,
            ttft_ms: ttft > 0 ? ttft : 0,
            measured_at: measuredAt ?? deps.nowIso(),
          } satisfies MeasuredPeaks;
        }),
      );

  const launchEvidence = (recipe: Recipe): Effect.Effect<LaunchEvidence | null> =>
    Effect.gen(function* () {
      const [host, input] = yield* Effect.all([
        deps.host().pipe(Effect.orElseSucceed(() => null)),
        deps.launchInput(recipe).pipe(Effect.orElseSucceed(() => null)),
      ]);
      if (!host || !input) return null;
      const plan = planLaunch({
        engine: input.engine,
        host,
        runtime: "docker",
        devices: [],
        port: input.portOverride ?? deps.inferencePort,
        modelPath: input.modelPath,
        servedModelName: input.servedModelName,
        options: input.options,
        extraArgs: input.extraArgs,
        env: input.env,
        dockerImage: input.dockerImage,
      });
      return {
        argv: plan.argv,
        image: plan.image ?? null,
        env: plan.env,
        containerPort: plan.ports[0]?.container ?? null,
        hostPort: plan.ports[0]?.host ?? null,
        modelMountTarget: plan.mounts[0]?.to ?? null,
      } satisfies LaunchEvidence;
    });

  /**
   * Build, redact, and validate the contribution for one recipe. The records
   * are fully formed here regardless of shareability, so the preview can show
   * exactly what a PR would contain.
   */
  const buildValidatedContribution = (
    recipe: Recipe,
  ): Effect.Effect<
    {
      contribution: Contribution;
      hardware: RegistryHardware;
      measured: boolean;
      working: boolean;
      redactions: string[];
      files: ShareFile[];
      validation: { ok: boolean; issues: readonly SchemaIssue[] };
    },
    ShareError
  > =>
    Effect.gen(function* () {
      const hardware = yield* matchedHardware().pipe(
        Effect.mapError((error) => new ShareFailed({ step: "registry", message: error.message })),
      );
      if (!hardware) {
        return yield* Effect.fail(
          new ShareUnavailable({
            message: "No local-ai-registry hardware record matches this machine",
          }),
        );
      }
      const [running, peaks, revision, launch, version, size, gpus] = yield* Effect.all([
        deps.isRunning(recipe.id).pipe(Effect.orElseSucceed(() => false)),
        measuredPeaks(recipe),
        deps.revisionFor(recipe.model_path).pipe(Effect.orElseSucceed(() => null)),
        launchEvidence(recipe),
        deps
          .engineVersion(recipe.port || deps.inferencePort)
          .pipe(Effect.orElseSucceed(() => null as string | null)),
        deps
          .sizeBytes(recipe.model_path)
          .pipe(
            Effect.orElseSucceed(() => null),
            Effect.map((bytes) =>
              bytes !== null && bytes > 0 ? Math.round((bytes / 1024 ** 3) * 10) / 10 : null,
            ),
          ),
        deps.gpus().pipe(Effect.orElseSucceed(() => [] as GpuInfo[])),
      ]);
      const repository = recipe.model_path.replace(/\\/g, "/").split("/").filter(Boolean).slice(-2).join("/");
      const raw = buildContribution({
        recipe,
        repository,
        modelName: modelNameFromRepository(repository),
        paramsB: null,
        precision: null,
        sizeGb: size,
        revision,
        hardware,
        hardwareCount: Math.max(1, recipe.tensor_parallel_size),
        engineVersion: version,
        launch,
        peaks,
        nowIso: deps.nowIso(),
        unmeasured: bypass,
      });
      const secrets = collectRedactionSecrets(gpus);
      const model = raw.model ? redactRecord(raw.model, secrets).record : undefined;
      const instance = redactRecord(raw.model_instance, secrets);
      const recipeRecord = redactRecord(raw.recipe, secrets);
      const redactions = [...new Set([...instance.redactions, ...recipeRecord.redactions])];
      const validation = [
        ...(model !== undefined ? [validateAgainstRegistrySchema("model", model)] : []),
        validateAgainstRegistrySchema("model-instance", instance.record),
        validateAgainstRegistrySchema("recipe", recipeRecord.record),
      ].reduce(
        (accumulator, result) => ({
          ok: accumulator.ok && result.ok,
          issues: [...accumulator.issues, ...result.issues],
        }),
        { ok: true, issues: [] as readonly SchemaIssue[] },
      );
      const contribution: Contribution = {
        ...(model !== undefined ? { model } : {}),
        model_instance: instance.record,
        recipe: recipeRecord.record,
        instance_id: raw.instance_id,
        recipe_id: raw.recipe_id,
        model_id: raw.model_id,
        paths: raw.paths,
      };
      const measured = running || peaks !== null;
      return {
        contribution,
        hardware,
        measured,
        working: measured || bypass,
        redactions,
        files: [
          ...(model !== undefined ? [{ path: raw.paths.model, record: model }] : []),
          { path: raw.paths.model_instance, record: instance.record },
          { path: raw.paths.recipe, record: recipeRecord.record },
        ],
        validation,
      };
    });

  const previewFor = (recipe: Recipe): Effect.Effect<SharePreviewPayload, ShareError> =>
    Effect.gen(function* () {
      const built = yield* buildValidatedContribution(recipe);
      const modelExists = yield* deps.registry
        .model(built.contribution.model_id)
        .pipe(Effect.orElseSucceed(() => null))
        .pipe(Effect.map((record) => (record !== null ? true : false)));
      const shareable = built.validation.ok && built.working;
      const reason = !built.working
        ? "This configuration has not run yet — launch it once (or record speed evidence) before sharing."
        : !built.validation.ok
          ? "The generated records do not satisfy the registry schema."
          : null;
      const files = modelExists
        ? built.files.filter((file) => !file.path.startsWith("model/"))
        : built.files;
      const dateStamp = deps.nowIso().slice(0, 10).replace(/-/g, "");
      return {
        recipe_id: recipe.id,
        recipe_name: recipe.name,
        shareable,
        reason,
        records: {
          ...(built.contribution.model !== undefined ? { model: built.contribution.model } : {}),
          model_instance: built.contribution.model_instance,
          recipe: built.contribution.recipe,
        },
        file_paths: files.map((file) => file.path),
        model_exists_in_registry: modelExists,
        validation: built.validation,
        redactions: built.redactions,
        hardware: {
          id: built.hardware.id,
          name: built.hardware.name,
          count: Math.max(1, recipe.tensor_parallel_size),
        },
        pr: {
          base_repo: `https://github.com/${REGISTRY_REPO}`,
          base_branch: REGISTRY_BASE_BRANCH,
          head_branch: `${HEAD_BRANCH_PREFIX}-${built.contribution.recipe_id}-${dateStamp}`,
          title: `Add ${built.contribution.recipe_id} (Local Studio)`,
          body: [
            `Contribution from Local Studio (recipe "${recipe.name}").`,
            "",
            `- hardware: ${built.hardware.name} ×${Math.max(1, recipe.tensor_parallel_size)}`,
            `- engine: ${recipe.backend}`,
            `- artifact: \`${
              (built.contribution.model_instance as { repository?: string }).repository ?? "unknown"
            }\``,
            "- records validated against the registry JSON Schemas before this PR was opened",
            ...(built.measured
              ? []
              : ["- **unmeasured**: shared with the Local Studio demo bypass; no speed evidence yet"]),
            "",
            'Generated by the Local Studio "Share config" flow.',
          ].join("\n"),
        },
      } satisfies SharePreviewPayload;
    });

  return {
    preview: (recipeId) =>
      Effect.gen(function* () {
        const recipe = yield* deps.getRecipe(recipeId).pipe(
          Effect.mapError(
            () => new ShareFailed({ step: "recipes", message: "Recipe store unavailable" }),
          ),
        );
        if (!recipe) return yield* Effect.fail(new ShareRecipeMissing({ recipeId }));
        return yield* previewFor(recipe);
      }),
    createPullRequest: (recipeId, confirm) =>
      Effect.gen(function* () {
        if (!confirm) {
          return yield* Effect.fail(
            new ShareConfirmationRequired({
              message: "Sharing requires an explicit confirmation before any pull request is created",
            }),
          );
        }
        const recipe = yield* deps.getRecipe(recipeId).pipe(
          Effect.mapError(
            () => new ShareFailed({ step: "recipes", message: "Recipe store unavailable" }),
          ),
        );
        if (!recipe) return yield* Effect.fail(new ShareRecipeMissing({ recipeId }));
        const payload = yield* previewFor(recipe);
        if (!payload.shareable || !payload.validation.ok) {
          return yield* Effect.fail(
            new ShareNotValid({
              message: payload.reason ?? "This configuration cannot be shared",
              issues: [...payload.validation.issues],
            }),
          );
        }
        const fail = (step: string): ((error: GitHubError) => ShareFailed) =>
          (error: GitHubError) => new ShareFailed({ step, message: error.message });
        const upstream = yield* deps.github.getRepo(REGISTRY_OWNER ?? "0xSero", REGISTRY_NAME ?? REGISTRY_REPO).pipe(
          Effect.mapError(fail("github")),
        );
        if (!upstream) {
          return yield* Effect.fail(
            new ShareFailed({ step: "github", message: `${REGISTRY_REPO} is not reachable` }),
          );
        }
        const fork = yield* deps.github.createFork(upstream.owner.login, REGISTRY_NAME ?? REGISTRY_REPO).pipe(
          Effect.mapError(fail("fork")),
        );
        const base = yield* deps.github
          .getBranch(upstream.owner.login, REGISTRY_NAME ?? REGISTRY_REPO, REGISTRY_BASE_BRANCH)
          .pipe(Effect.mapError(fail("github")));
        if (!base) {
          return yield* Effect.fail(
            new ShareFailed({ step: "github", message: `Base branch ${REGISTRY_BASE_BRANCH} not found` }),
          );
        }
        yield* deps.github
          .createBranch(
            fork.owner.login,
            REGISTRY_NAME ?? REGISTRY_REPO,
            payload.pr.head_branch,
            base.sha,
          )
          .pipe(Effect.mapError(fail("branch")));
        for (const path of payload.file_paths) {
          const record = path.startsWith("model-instance/")
            ? payload.records.model_instance
            : path.startsWith("model/")
              ? payload.records.model
              : payload.records.recipe;
          yield* deps.github
            .putFile({
              owner: fork.owner.login,
              repo: REGISTRY_NAME ?? REGISTRY_REPO,
              branch: payload.pr.head_branch,
              path,
              content: `${JSON.stringify(record, null, 2)}\n`,
              message: `Add ${payload.recipe_id} from Local Studio`,
            })
            .pipe(Effect.mapError(fail("commit")));
        }
        const pull = yield* deps.github
          .createPull({
            owner: upstream.owner.login,
            repo: REGISTRY_NAME ?? REGISTRY_REPO,
            title: payload.pr.title,
            head: `${fork.owner.login}:${payload.pr.head_branch}`,
            base: REGISTRY_BASE_BRANCH,
            body: payload.pr.body,
          })
          .pipe(Effect.mapError(fail("pull-request")));
        return {
          pull_request_url: pull.html_url,
          number: pull.number,
          head_branch: payload.pr.head_branch,
          files: payload.file_paths,
        } satisfies SharePullRequestResult;
      }),
  } satisfies ShareService;
};

export const shareErrorStatus = (error: ShareError): number => {
  switch (error._tag) {
    case "ShareRecipeMissing":
      return 404;
    case "ShareConfirmationRequired":
      return 400;
    case "ShareNotValid":
    case "ShareUnavailable":
      return 422;
    case "ShareFailed":
      return 502;
  }
};

/** Production wiring: registry + GitHub clients and controller stores. */
export const shareDependenciesFromContext = (context: {
  stores: {
    recipeStore: { get: (id: string) => Effect.Effect<Recipe | null, unknown> };
    downloadStore: { list: () => Effect.Effect<ModelDownload[], unknown> };
    peakMetricsStore: {
      getEffect: (key: string) => Effect.Effect<Record<string, unknown> | null, unknown>;
    };
  };
  compute: {
    host: () => Effect.Effect<HostProfile>;
    instances: () => Effect.Effect<readonly { record: { recipeId: string }; state: string }[]>;
  };
  config: { inference_port: number };
  toLaunchInput: (recipe: Recipe) => ComputeLaunchInput;
}): ShareDependencies => ({
  getRecipe: (recipeId) => context.stores.recipeStore.get(recipeId),
  isRunning: (recipeId) =>
    Effect.map(
      context.compute.instances(),
      (views) => views.some((view) => view.record.recipeId === recipeId && view.state === "ready"),
    ),
  peaks: (modelKey) => context.stores.peakMetricsStore.getEffect(modelKey),
  revisionFor: (modelPath) =>
    Effect.map(
      context.stores.downloadStore.list(),
      (downloads) =>
        downloads.find(
          (download) =>
            download.status === "completed" &&
            (download.target_dir === modelPath || modelPath.endsWith(download.target_dir)),
        )?.revision ?? null,
    ),
  gpus: () => getGpuInfo(),
  host: () => context.compute.host(),
  launchInput: (recipe) => Effect.succeed(context.toLaunchInput(recipe)),
  sizeBytes: (modelPath) => estimateWeightsSizeBytes(modelPath, true),
  engineVersion: (port) =>
    Effect.tryPromise({
      try: (signal) =>
        fetch(`http://127.0.0.1:${port}/version`, {
          signal: AbortSignal.any([AbortSignal.timeout(2_000), signal]),
        }),
      catch: () => null,
    }).pipe(
      Effect.flatMap((response) =>
        response.ok
          ? Effect.tryPromise({
              try: () => response.json(),
              catch: () => null,
            })
          : Effect.succeed(null),
      ),
      Effect.map((body) => {
        const version = (body as { version?: unknown } | null)?.["version"];
        return typeof version === "string" ? version : null;
      }),
      Effect.orElseSucceed(() => null),
    ),
  registry: makeRegistryClient(),
  // Demo override: point pull-request creation at a local mock GitHub API.
  github: makeGitHubClient({
    ...(process.env["LOCAL_AI_REGISTRY_GITHUB_API"]?.trim()
      ? { apiBase: process.env["LOCAL_AI_REGISTRY_GITHUB_API"].trim() }
      : {}),
  }),
  inferencePort: context.config.inference_port,
  nowIso: () => new Date().toISOString(),
});
