import { randomUUID } from "node:crypto";
import {
  ScientificComputeLeaseIssueSchema,
  ScientificDatasetAttachmentIssueSchema,
  ScientificExperimentReceiptFinalizeSchema,
  ScientificNotebookCreateSchema,
  ScientificNotebookStateUpdateSchema,
  ScientificRayJobSubmissionSchema,
  type ScientificNotebookSession,
} from "@local-studio/contracts/scientific-workbench";
import {
  NotebookApprovalRequestSchema,
  NotebookCellExecuteSchema,
  NotebookCellPatchSchema,
  NotebookCellStructureSchema,
} from "@local-studio/contracts/notebook-agent";
import { Effect } from "effect";
import { badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import {
  admitScientificRayJob,
  createScientificExperimentReceipt,
  createScientificRayJobRecord,
  discoverScientificModelCatalog,
  issueScientificComputeLease,
  issueScientificDatasetAttachment,
  transitionScientificNotebook,
} from "./service";
import type { KubeRayGateway } from "./kuberay-gateway";
import type { ScientificRayJobRecord } from "./types";
import {
  bindScientificNotebookOwner,
  canAccessScientificNotebook,
  canAccessScientificRayJob,
  canAccessScientificReceipt,
  requireScientificNotebookAccess,
  requireScientificNotebookMutationOwner,
  requireScientificRayJobAccess,
  requireScientificReceiptAccess,
  requireScientificSubmissionOwner,
  scientificActorId,
  scientificNotebookIdentity,
  scientificPrincipalScope,
} from "./enterprise-identity";
import { notebookDocumentPath, projectQuery, required } from "./route-input";

export const registerScientificWorkbenchRoutes = defineRoutes((app, context) => {
  const store = context.stores.scientificWorkbenchStore;
  const requireRayJob = (jobId: string): Effect.Effect<ScientificRayJobRecord, unknown> =>
    store
      .getRayJob(jobId)
      .pipe(
        Effect.flatMap((job) =>
          job ? Effect.succeed(job) : Effect.fail(notFound("RayJob not found")),
        ),
      );
  const requireGateway = (): Effect.Effect<KubeRayGateway, unknown> =>
    context.kubeRayGateway
      ? Effect.succeed(context.kubeRayGateway)
      : Effect.fail(
          serviceUnavailable(
            "KubeRay gateway is not configured; set its API URL and workload token file",
          ),
        );
  const requireNotebook = (notebookId: string): Effect.Effect<ScientificNotebookSession, unknown> =>
    store
      .getNotebook(notebookId)
      .pipe(
        Effect.flatMap((notebook) =>
          notebook?.document_path
            ? Effect.succeed(notebook)
            : Effect.fail(notFound("Governed notebook document not found")),
        ),
      );
  return mergeRoutes(
    app.get(
      "/workbench/notebooks",
      documentRoute,
      effectHandler((ctx) =>
        store.listNotebooks(projectQuery(ctx.req.query("project_id"))).pipe(
          Effect.map((notebooks) =>
            ctx.json({
              notebooks: notebooks.filter((notebook) =>
                canAccessScientificNotebook(ctx.get("enterprisePrincipal"), notebook),
              ),
            }),
          ),
        ),
      ),
    ),
    app.post(
      "/workbench/notebooks",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, ScientificNotebookCreateSchema);
          const now = new Date().toISOString();
          const notebook: ScientificNotebookSession = {
            id: randomUUID(),
            project_id: required(body.project_id, "project_id"),
            owner_id: required(
              bindScientificNotebookOwner(ctx.get("enterprisePrincipal"), body.owner_id),
              "owner_id",
            ),
            ...(ctx.get("enterprisePrincipal")
              ? { owner_principal: scientificPrincipalScope(ctx.get("enterprisePrincipal")!) }
              : {}),
            runtime: body.runtime,
            document_path: notebookDocumentPath(body.document_path),
            state: "requested",
            classification: body.classification,
            compute_profile_id: required(body.compute_profile_id, "compute_profile_id"),
            image_digest: required(body.image_digest, "image_digest"),
            created_at: now,
            updated_at: now,
            expires_at: required(body.expires_at, "expires_at"),
          };
          yield* store.saveNotebook(notebook);
          return ctx.json({ notebook }, 201);
        }),
      ),
    ),
    app.get(
      "/workbench/notebooks/:notebookId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const notebook = yield* store.getNotebook(ctx.req.param("notebookId") ?? "");
          if (!notebook) return yield* Effect.fail(notFound("Notebook not found"));
          requireScientificNotebookAccess(ctx.get("enterprisePrincipal"), notebook);
          return ctx.json({ notebook });
        }),
      ),
    ),
    app.patch(
      "/workbench/notebooks/:notebookId/state",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const notebookId = ctx.req.param("notebookId") ?? "";
          const current = yield* store.getNotebook(notebookId);
          if (!current) return yield* Effect.fail(notFound("Notebook not found"));
          requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), current);
          const body = yield* decodeJsonBody(ctx, ScientificNotebookStateUpdateSchema);
          const notebook = yield* Effect.try({
            try: () => transitionScientificNotebook(current, body.state, new Date().toISOString()),
            catch: (error) => error,
          });
          yield* store.saveNotebook(notebook);
          return ctx.json({ notebook });
        }),
      ),
    ),
    app.get(
      "/workbench/ray-jobs",
      documentRoute,
      effectHandler((ctx) =>
        store.listRayJobs(projectQuery(ctx.req.query("project_id"))).pipe(
          Effect.map((jobs) =>
            ctx.json({
              jobs: jobs.filter((job) =>
                canAccessScientificRayJob(ctx.get("enterprisePrincipal"), job),
              ),
            }),
          ),
        ),
      ),
    ),
    app.post(
      "/workbench/compute-leases",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, ScientificComputeLeaseIssueSchema);
          const notebook = yield* store.getNotebook(body.notebook_id);
          if (!notebook) return yield* Effect.fail(notFound("Notebook not found"));
          requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), notebook);
          const lease = yield* Effect.try({
            try: () => issueScientificComputeLease(body, notebook, new Date().toISOString()),
            catch: (error) => error,
          });
          yield* store.saveComputeLease(lease);
          return ctx.json({ lease }, 201);
        }),
      ),
    ),
    app.post(
      "/workbench/dataset-attachments",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, ScientificDatasetAttachmentIssueSchema);
          const actorId = required(
            scientificActorId(
              ctx.get("enterprisePrincipal"),
              ctx.req.header("x-local-studio-actor-id"),
            ),
            "actor identity",
          );
          const projectId = required(
            ctx.req.header("x-local-studio-project-id") ?? "",
            "project identity",
          );
          if (!actorId || projectId !== body.project_id) {
            return yield* Effect.fail(notFound("Project not found"));
          }
          const attachment = yield* Effect.try({
            try: () => issueScientificDatasetAttachment(body, new Date().toISOString()),
            catch: (error) => error,
          });
          yield* store.saveDatasetAttachment(attachment);
          return ctx.json({ attachment }, 201);
        }),
      ),
    ),
    app.post(
      "/workbench/ray-jobs",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const submission = yield* decodeJsonBody(ctx, ScientificRayJobSubmissionSchema);
          requireScientificSubmissionOwner(ctx.get("enterprisePrincipal"), submission.requested_by);
          const existing = yield* store.getRayJob(submission.id);
          if (existing) {
            requireScientificRayJobAccess(ctx.get("enterprisePrincipal"), existing);
            if (JSON.stringify(existing.submission) !== JSON.stringify(submission)) {
              return yield* Effect.fail(
                badRequest(`RayJob submission "${submission.id}" already exists`),
              );
            }
            return ctx.json({ job: existing }, 200);
          }
          const notebook = yield* store.getNotebook(submission.notebook_id);
          if (notebook) {
            requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), notebook);
          }
          const computeLease = yield* store.getComputeLease(submission.compute_lease_id);
          const attachments = yield* Effect.forEach(submission.datasets, ({ attachment_id }) =>
            store.getDatasetAttachment(attachment_id),
          );
          if (attachments.some((attachment) => attachment === null)) {
            return yield* Effect.fail(badRequest("Dataset attachment does not exist"));
          }
          const bearer = ctx.get("enterpriseBearerToken");
          const modelCatalog = yield* discoverScientificModelCatalog(
            context.config.providers,
            fetch,
            {
              secretStore: context.providerSecretStore,
              principal: ctx.get("enterprisePrincipal"),
              ...(bearer ? { verifiedBearerToken: bearer } : {}),
              signal: ctx.req.raw.signal,
            },
          );
          yield* Effect.try({
            try: () =>
              admitScientificRayJob(
                submission,
                notebook,
                new Set(
                  context.config.providers.filter(({ enabled }) => enabled).map(({ id }) => id),
                ),
                {
                  computeLease,
                  datasetAttachments: new Map(
                    attachments.map((attachment) => [attachment!.attachment_id, attachment!]),
                  ),
                  modelCatalog,
                  now: new Date().toISOString(),
                },
              ),
            catch: (error) => error,
          });
          const record = createScientificRayJobRecord(
            submission,
            new Date().toISOString(),
            ctx.get("enterprisePrincipal"),
          );
          yield* store.saveRayJob(submission, record);
          return ctx.json({ job: record }, 202);
        }),
      ),
    ),
    app.post(
      "/workbench/ray-jobs/:jobId/submit",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const gateway = yield* requireGateway();
          const job = yield* requireRayJob(ctx.req.param("jobId") ?? "");
          const notebook = yield* store.getNotebook(job.submission.notebook_id);
          if (!notebook) return yield* Effect.fail(notFound("Notebook not found"));
          requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), notebook);
          const updated = yield* gateway.submit(job, new Date().toISOString());
          yield* store.saveRayJob(updated.submission, updated);
          return ctx.json({ job: updated }, 202);
        }),
      ),
    ),
    app.post(
      "/workbench/ray-jobs/:jobId/reconcile",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const gateway = yield* requireGateway();
          const job = yield* requireRayJob(ctx.req.param("jobId") ?? "");
          const notebook = yield* store.getNotebook(job.submission.notebook_id);
          if (!notebook) return yield* Effect.fail(notFound("Notebook not found"));
          requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), notebook);
          if (job.state === "queued") {
            return yield* Effect.fail(badRequest("RayJob has not been submitted"));
          }
          const updated = yield* gateway.reconcile(job, new Date().toISOString());
          yield* store.saveRayJob(updated.submission, updated);
          return ctx.json({ job: updated });
        }),
      ),
    ),
    app.get(
      "/workbench/receipts",
      documentRoute,
      effectHandler((ctx) =>
        store.listReceipts(projectQuery(ctx.req.query("project_id"))).pipe(
          Effect.map((receipts) =>
            ctx.json({
              receipts: receipts.filter((receipt) =>
                canAccessScientificReceipt(ctx.get("enterprisePrincipal"), receipt),
              ),
            }),
          ),
        ),
      ),
    ),
    app.get(
      "/workbench/receipts/:receiptId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const receipt = yield* store.getReceipt(ctx.req.param("receiptId") ?? "");
          if (!receipt) return yield* Effect.fail(notFound("Experiment receipt not found"));
          requireScientificReceiptAccess(ctx.get("enterprisePrincipal"), receipt);
          return ctx.json({ receipt });
        }),
      ),
    ),
    app.post(
      "/workbench/ray-jobs/:jobId/receipt",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const job = yield* requireRayJob(ctx.req.param("jobId") ?? "");
          requireScientificRayJobAccess(ctx.get("enterprisePrincipal"), job);
          const existing = yield* store.getReceiptBySubmission(job.submission.id);
          if (existing) {
            requireScientificReceiptAccess(ctx.get("enterprisePrincipal"), existing);
            return ctx.json({ receipt: existing });
          }
          const notebook = yield* store.getNotebook(job.submission.notebook_id);
          if (!notebook) {
            return yield* Effect.fail(notFound("Notebook not found"));
          }
          requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), notebook);
          if (!notebook.document_path) {
            return yield* Effect.fail(notFound("Governed notebook document not found"));
          }
          const document = yield* context.notebookGateway.inspect(
            notebook.document_path,
            scientificNotebookIdentity(notebook),
          );
          const interactions = yield* context.notebookGateway.listEvents(notebook.id);
          const foundryEvidence = yield* store.listFoundryInvocationEvidence(job.submission.id);
          const body = yield* decodeJsonBody(ctx, ScientificExperimentReceiptFinalizeSchema);
          const receipt = yield* Effect.try({
            try: () =>
              createScientificExperimentReceipt(
                job,
                notebook,
                document.revision,
                interactions,
                body,
                context.config.scientific_receipt_signing_key ?? "",
                ctx.get("enterprisePrincipal"),
                foundryEvidence,
              ),
            catch: (error) => error,
          });
          yield* store.saveReceipt(job.submission.project_id, receipt);
          return ctx.json({ receipt }, 201);
        }),
      ),
    ),
    app.get(
      "/workbench/notebooks/:notebookId/document",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const session = yield* requireNotebook(ctx.req.param("notebookId") ?? "");
          requireScientificNotebookAccess(ctx.get("enterprisePrincipal"), session);
          const identity = scientificNotebookIdentity(session);
          const notebook = yield* context.notebookGateway.inspect(session.document_path!, identity);
          return ctx.json({ notebook });
        }),
      ),
    ),
    app.patch(
      "/workbench/notebooks/:notebookId/document",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const session = yield* requireNotebook(ctx.req.param("notebookId") ?? "");
          requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), session);
          const identity = scientificNotebookIdentity(session);
          const body = yield* decodeJsonBody(ctx, NotebookCellPatchSchema);
          const notebook = yield* context.notebookGateway.patch(
            session.document_path!,
            body,
            identity,
          );
          return ctx.json({ notebook });
        }),
      ),
    ),
    app.post(
      "/workbench/notebooks/:notebookId/document/execute",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const session = yield* requireNotebook(ctx.req.param("notebookId") ?? "");
          requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), session);
          const identity = scientificNotebookIdentity(session);
          const body = yield* decodeJsonBody(ctx, NotebookCellExecuteSchema);
          const notebook = yield* context.notebookGateway.execute(
            session.document_path!,
            body,
            identity,
          );
          return ctx.json({ notebook });
        }),
      ),
    ),
    app.post(
      "/workbench/notebooks/:notebookId/document/structure",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const session = yield* requireNotebook(ctx.req.param("notebookId") ?? "");
          requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), session);
          const identity = scientificNotebookIdentity(session);
          const body = yield* decodeJsonBody(ctx, NotebookCellStructureSchema);
          const notebook = yield* context.notebookGateway.structure(
            session.document_path!,
            body,
            identity,
          );
          return ctx.json({ notebook });
        }),
      ),
    ),
    app.post(
      "/workbench/notebooks/:notebookId/approvals",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const session = yield* requireNotebook(ctx.req.param("notebookId") ?? "");
          requireScientificNotebookMutationOwner(ctx.get("enterprisePrincipal"), session);
          const identity = scientificNotebookIdentity(session);
          const body = yield* decodeJsonBody(ctx, NotebookApprovalRequestSchema);
          const current = yield* context.notebookGateway.inspect(session.document_path!);
          if (current.revision !== body.expected_revision) {
            return yield* Effect.fail(badRequest("Notebook changed before approval"));
          }
          const approval = context.notebookGateway.issueApproval({
            ...identity,
            expected_revision: body.expected_revision,
            operation: body.operation,
            cell_index: body.cell_index,
          });
          return ctx.json({ approval }, 201);
        }),
      ),
    ),
    app.get(
      "/workbench/notebooks/:notebookId/interactions",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const session = yield* requireNotebook(ctx.req.param("notebookId") ?? "");
          requireScientificNotebookAccess(ctx.get("enterprisePrincipal"), session);
          scientificNotebookIdentity(session);
          const events = yield* context.notebookGateway.listEvents(session.id);
          return ctx.json({ events });
        }),
      ),
    ),
  );
});
