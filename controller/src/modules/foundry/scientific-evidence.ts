import { createHash } from "node:crypto";
import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import { Effect } from "effect";
import type { AppContext } from "../../app-context";
import { badRequest } from "../../core/errors";
import {
  requireScientificRayJobAccess,
  scientificPrincipalScope,
} from "../workbench/enterprise-identity";

export type FoundryInvocationKind = "model_invocation" | "agent_invocation";

export const resolveScientificEvidenceLink = (
  context: AppContext,
  principal: NormalizedPrincipal,
  providerId: string,
  resourceId: string,
  event: FoundryInvocationKind,
  assertedSubmissionId?: string,
): Effect.Effect<string | undefined, unknown> =>
  Effect.gen(function* () {
    const submissionId = assertedSubmissionId?.trim();
    if (!submissionId) return undefined;
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(submissionId)) {
      return yield* Effect.fail(badRequest("Scientific evidence link denied"));
    }
    const job = yield* context.stores.scientificWorkbenchStore.getRayJob(submissionId);
    if (!job) return yield* Effect.fail(badRequest("Scientific evidence link denied"));
    requireScientificRayJobAccess(principal, job);
    if (
      event === "model_invocation" &&
      !job.submission.models.some(
        (model) => model.provider_id === providerId && model.model_id === resourceId,
      )
    ) {
      return yield* Effect.fail(badRequest("Scientific evidence link denied"));
    }
    return submissionId;
  });

export const saveScientificFoundryEvidence = (
  context: AppContext,
  input: {
    submissionId: string;
    principal: NormalizedPrincipal;
    providerId: string;
    resourceId: string;
    correlationId: string;
    event: FoundryInvocationKind;
    upstreamBody: ReadableStream<Uint8Array> | null;
  },
): Effect.Effect<void, unknown> => {
  const id = `sha256:${createHash("sha256")
    .update(
      [
        input.submissionId,
        input.correlationId,
        input.event,
        input.providerId,
        input.resourceId,
        input.principal.issuer,
        input.principal.issuer_id,
        input.principal.tenant,
        input.principal.subject,
      ].join("\u0000"),
    )
    .digest("hex")}`;
  return context.stores.scientificWorkbenchStore
    .saveFoundryInvocationEvidence({
      id,
      submission_id: input.submissionId,
      principal: scientificPrincipalScope(input.principal),
      kind: input.event === "model_invocation" ? "model" : "agent",
      provider_id: input.providerId,
      resource_id: input.resourceId,
      correlation_id: input.correlationId,
      observed_at: new Date().toISOString(),
    })
    .pipe(
      Effect.tapError(() =>
        input.upstreamBody
          ? Effect.tryPromise({
              try: () => input.upstreamBody!.cancel(),
              catch: () => undefined,
            }).pipe(Effect.ignore)
          : Effect.void,
      ),
    );
};
