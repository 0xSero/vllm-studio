import {
  MachineEnrollmentProfileSchema,
  MachineLifecycleStateSchema,
  type MachineEnrollmentRecord,
  type MachineOwnedResource,
} from "@local-studio/contracts/machine-enrollment";
import { Effect, Schema } from "effect";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { defineRoutes, documentRoute, mergeRoutes } from "../../http/route-registrar";

const MachineTransitionSchema = Schema.Struct({
  state: MachineLifecycleStateSchema,
  reason: Schema.String,
});

const machineEffect = <A>(operation: () => A): Effect.Effect<A, ReturnType<typeof badRequest>> =>
  Effect.try({
    try: operation,
    catch: (error) => badRequest(error instanceof Error ? error.message : "Machine operation failed"),
  });

const fixtureResource = (machineId: string): MachineOwnedResource => ({
  resource_id: `controller-record:${machineId}`,
  kind: "controller-record",
  external_ref: `loopback:machine:${machineId}`,
  ownership: "local-studio",
  apply_action: "create",
  rollback_action: "remove",
});

const rollbackFixture = (machineId: string, resource: MachineOwnedResource): Effect.Effect<void, Error> =>
  resource.resource_id === `controller-record:${machineId}` &&
  resource.kind === "controller-record" &&
  resource.external_ref === `loopback:machine:${machineId}` &&
  resource.ownership === "local-studio"
    ? Effect.void
    : Effect.fail(new Error(`Refused rollback of unowned resource "${resource.resource_id}"`));

const machineById = (
  records: readonly MachineEnrollmentRecord[],
  machineId: string,
): Effect.Effect<MachineEnrollmentRecord, ReturnType<typeof notFound>> => {
  const record = records.find(({ profile }) => profile.machine_id === machineId);
  return record
    ? Effect.succeed(record)
    : Effect.fail(notFound(`Machine "${machineId}" is not enrolled`));
};

export const registerMachineRoutes = defineRoutes((app, context) => {
  const service = context.machineEnrollmentService;
  const offboard = (machineId: string): Effect.Effect<MachineEnrollmentRecord, unknown> =>
    service.offboard(machineId, (resource) => rollbackFixture(machineId, resource));

  return mergeRoutes(
    app.get(
      "/machines",
      documentRoute,
      effectHandler((ctx) => Effect.sync(() => ctx.json({ machines: service.list() }))),
    ),
    app.get(
      "/machines/:machineId",
      documentRoute,
      effectHandler((ctx) =>
        machineById(service.list(), ctx.req.param("machineId") ?? "").pipe(
          Effect.map((machine) => ctx.json({ machine })),
        ),
      ),
    ),
    app.post(
      "/machines",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const profile = yield* decodeJsonBody(ctx, MachineEnrollmentProfileSchema);
          const machine = yield* machineEffect(() => service.register(profile));
          return ctx.json({ machine }, 201);
        }),
      ),
    ),
    app.put(
      "/machines/:machineId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const profile = yield* decodeJsonBody(ctx, MachineEnrollmentProfileSchema);
          if (profile.machine_id !== (ctx.req.param("machineId") ?? "")) {
            return yield* Effect.fail(badRequest("Path and profile machine IDs must match"));
          }
          const machine = yield* machineEffect(() => service.register(profile));
          return ctx.json({ machine });
        }),
      ),
    ),
    app.post(
      "/machines/:machineId/plan",
      documentRoute,
      effectHandler((ctx) =>
        machineById(service.list(), ctx.req.param("machineId") ?? "").pipe(
          Effect.map((machine) =>
            ctx.json({
              plan: {
                machine_id: machine.profile.machine_id,
                digest: machine.plan_digest,
                state: machine.state,
                runtime_refs: machine.profile.runtime_refs,
                access_refs: machine.profile.access_refs,
                agent_refs: machine.profile.agent_refs,
              },
            }),
          ),
        ),
      ),
    ),
    app.patch(
      "/machines/:machineId/state",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, MachineTransitionSchema);
          const machine = yield* machineEffect(() =>
            service.transition(ctx.req.param("machineId") ?? "", body.state, body.reason),
          );
          return ctx.json({ machine });
        }),
      ),
    ),
    app.post(
      "/machines/:machineId/apply",
      documentRoute,
      effectHandler((ctx) =>
        machineEffect(() => {
          const machineId = ctx.req.param("machineId") ?? "";
          return service.apply(machineId, [fixtureResource(machineId)]);
        }).pipe(Effect.map((machine) => ctx.json({ machine }))),
      ),
    ),
    app.post(
      "/machines/:machineId/reconcile",
      documentRoute,
      effectHandler((ctx) =>
        machineEffect(() => service.reconcile(ctx.req.param("machineId") ?? "")).pipe(
          Effect.map((machine) => ctx.json({ machine })),
        ),
      ),
    ),
    app.delete(
      "/machines/:machineId",
      documentRoute,
      effectHandler((ctx) =>
        offboard(ctx.req.param("machineId") ?? "").pipe(
          Effect.map((machine) => ctx.json({ machine })),
          Effect.mapError((error) => badRequest(String(error))),
        ),
      ),
    ),
    app.post(
      "/machines/:machineId/recovery",
      documentRoute,
      effectHandler((ctx) =>
        offboard(ctx.req.param("machineId") ?? "").pipe(
          Effect.map((machine) => ctx.json({ machine })),
          Effect.mapError((error) => badRequest(String(error))),
        ),
      ),
    ),
  );
});
