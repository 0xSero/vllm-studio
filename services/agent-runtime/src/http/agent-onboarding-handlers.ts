import { timingSafeEqual } from "node:crypto";
import { Effect, Schema } from "effect";
import { readJsonRequestWithinLimit } from "../../../../shared/agent/agent-turn-body";
import {
  FastCrwSearchInputSchema,
  OnboardingProbeInputSchema,
  OnboardingSaveInputSchema,
} from "../agent-onboarding-contract";
import { AgentOnboardingError } from "../agent-onboarding-error";
import { applyOnboarding, revokeOnboarding } from "../agent-onboarding-lifecycle";
import {
  getOnboardingState,
  probeOnboardingTarget,
  proxyOnboardingInference,
  saveOnboarding,
  searchFastCrw,
} from "../agent-onboarding-service";

const bodyLimit = 1024 * 1024;

const authorized = (request: Request, expected: string | undefined): Response | null => {
  if (!expected) {
    return Response.json({ error: "Agent onboarding API is not configured" }, { status: 503 });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right)
    ? null
    : Response.json({ error: "Unauthorized" }, { status: 401 });
};

const respond = async (operation: () => Promise<unknown>): Promise<Response> => {
  try {
    return Response.json(await operation());
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AgentOnboardingError ? error.message : "Agent onboarding request failed",
      },
      { status: error instanceof AgentOnboardingError ? error.status : 500 },
    );
  }
};

const readBody = async (request: Request): Promise<unknown> => {
  const body = await readJsonRequestWithinLimit(request, bodyLimit);
  if (!body.ok) throw new AgentOnboardingError(body.status, body.error);
  return body.value;
};

const decodeBody = async <A>(request: Request, decode: (value: unknown) => A): Promise<A> => {
  try {
    return decode(await readBody(request));
  } catch (error) {
    if (error instanceof AgentOnboardingError) throw error;
    throw new AgentOnboardingError(400, "Agent onboarding request is invalid");
  }
};

export const createAgentOnboardingHandlers = (
  token: () => string | undefined = () =>
    process.env.LOCAL_STUDIO_AGENT_ONBOARDING_TOKEN ??
    process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN,
) => {
  const handle = (request: Request, operation: () => Promise<unknown>) => {
    const denied = authorized(request, token());
    return denied ? Promise.resolve(denied) : respond(operation);
  };
  return {
    get: (request: Request) => handle(request, () => Effect.runPromise(getOnboardingState())),
    save: (request: Request) =>
      handle(request, async () => {
        const input = await decodeBody(
          request,
          Schema.decodeUnknownSync(OnboardingSaveInputSchema),
        );
        return Effect.runPromise(saveOnboarding(input));
      }),
    probe: (request: Request) =>
      handle(request, async () => {
        const input = await decodeBody(
          request,
          Schema.decodeUnknownSync(OnboardingProbeInputSchema),
        );
        return Effect.runPromise(probeOnboardingTarget(input));
      }),
    search: (request: Request) =>
      handle(request, async () => {
        const input = await decodeBody(request, Schema.decodeUnknownSync(FastCrwSearchInputSchema));
        return Effect.runPromise(searchFastCrw(input));
      }),
    inference: (request: Request, path: string[]) => {
      const denied = authorized(request, token());
      if (denied) return Promise.resolve(denied);
      return Effect.runPromise(proxyOnboardingInference(request, path)).catch((error) =>
        Response.json(
          {
            error: error instanceof AgentOnboardingError ? error.message : "Inference proxy failed",
          },
          { status: error instanceof AgentOnboardingError ? error.status : 500 },
        ),
      );
    },
    apply: (request: Request) => handle(request, applyOnboarding),
    revoke: (request: Request) => handle(request, revokeOnboarding),
  };
};
