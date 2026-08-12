import { Effect, Schema } from "effect";

const JsonObjectSchema = Schema.Record(Schema.String, Schema.Unknown);

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export const readJsonBody = (request: Request) => decodeJson(request, JsonObjectSchema);

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type JsonFailure = {
  fallback: string;
  status?: number | ((error: unknown) => number);
  project?: (error: unknown) => unknown | Response;
};

const responseFor = <A>(value: A | Response): Response =>
  value instanceof Response ? value : Response.json(value);

const failureResponse = (error: unknown, failure: JsonFailure): Response =>
  failure.project
    ? responseFor(failure.project(error))
    : jsonError(
        errorMessage(error, failure.fallback),
        typeof failure.status === "function" ? failure.status(error) : (failure.status ?? 500),
      );

export function jsonEffect<A, E>(
  effect: Effect.Effect<A, E>,
  project: (value: A) => unknown | Response,
  failure: JsonFailure,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.map((value) => responseFor(project(value))),
      Effect.catch((error) => Effect.succeed(failureResponse(error, failure))),
    ),
  );
}

export function jsonTask<A>(
  task: () => Promise<A>,
  project: (value: A) => unknown | Response,
  failure: JsonFailure,
): Promise<Response> {
  return jsonEffect(Effect.tryPromise({ try: task, catch: (error) => error }), project, failure);
}

export async function decodeJson<A>(
  request: Request,
  schema: Schema.ConstraintDecoder<A>,
): Promise<A | null> {
  try {
    return Schema.decodeUnknownSync(schema)(await request.json());
  } catch {
    return null;
  }
}
