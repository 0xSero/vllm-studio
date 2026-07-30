import { randomUUID } from "node:crypto";
import {
  ExperimentRecordCreateSchema,
  ExperimentRecordUpdateSchema,
  type ExperimentRecord,
} from "@local-studio/contracts/experiment-tracking";
import { Effect } from "effect";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes } from "../../http/route-registrar";

export const registerExperimentTrackingRoutes = defineRoutes((app, context) => {
  const store = context.stores.experimentTrackingStore;

  return app
    .get(
      "/experiments",
      documentRoute,
      effectHandler((ctx) =>
        store
          .listExperiments(ctx.req.query("project_id") || undefined)
          .pipe(Effect.map((experiments) => ctx.json({ experiments }))),
      ),
    )
    .get(
      "/experiments/:experimentId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const experiment = yield* store.getExperiment(ctx.req.param("experimentId") ?? "");
          if (!experiment) return yield* Effect.fail(notFound("Experiment not found"));
          return ctx.json({ experiment });
        }),
      ),
    )
    .get(
      "/experiments/:experimentId/lineage",
      documentRoute,
      effectHandler((ctx) =>
        store
          .listExperimentLineage(ctx.req.param("experimentId") ?? "")
          .pipe(Effect.map((lineage) => ctx.json({ lineage }))),
      ),
    )
    .post(
      "/experiments",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, ExperimentRecordCreateSchema);
          if (!body.name.trim()) {
            return yield* Effect.fail(badRequest("Experiment name is required"));
          }
          const now = new Date().toISOString();
          const experiment: ExperimentRecord = {
            id: randomUUID(),
            project_id: body.project_id,
            name: body.name,
            parameters: body.parameters ?? {},
            metrics: {},
            notes: body.notes,
            artifacts: [],
            parent_experiment_id: body.parent_experiment_id,
            status: "running",
            created_at: now,
            updated_at: now,
          };
          yield* store.saveExperiment(experiment);
          return ctx.json({ experiment }, 201);
        }),
      ),
    )
    .patch(
      "/experiments/:experimentId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const experimentId = ctx.req.param("experimentId") ?? "";
          const existing = yield* store.getExperiment(experimentId);
          if (!existing) return yield* Effect.fail(notFound("Experiment not found"));
          const body = yield* decodeJsonBody(ctx, ExperimentRecordUpdateSchema);
          const updated: ExperimentRecord = {
            ...existing,
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.parameters !== undefined ? { parameters: body.parameters } : {}),
            ...(body.metrics !== undefined ? { metrics: body.metrics } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
            ...(body.artifacts !== undefined ? { artifacts: body.artifacts } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.completed_at !== undefined ? { completed_at: body.completed_at } : {}),
            updated_at: new Date().toISOString(),
          };
          yield* store.saveExperiment(updated);
          return ctx.json({ experiment: updated });
        }),
      ),
    )
    .delete(
      "/experiments/:experimentId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const experimentId = ctx.req.param("experimentId") ?? "";
          const existing = yield* store.getExperiment(experimentId);
          if (!existing) return yield* Effect.fail(notFound("Experiment not found"));
          yield* store.deleteExperiment(experimentId);
          return ctx.json({ success: true });
        }),
      ),
    );
});
