import { timingSafeEqual } from "node:crypto";
import {
  AgentLifecycleController,
  type AgentLifecycleIntegration,
} from "../agent-lifecycle-controller";
import { AgentLifecycleError } from "../agent-lifecycle-service";
import { readJsonRequestWithinLimit } from "../../../../shared/agent/agent-turn-body";

const bodyLimit = 1024 * 1024;

const authorized = (request: Request, expected: string | undefined): Response | null => {
  if (!expected)
    return Response.json({ error: "Agent lifecycle API is not configured" }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
};

const response = async (operation: () => Promise<unknown>): Promise<Response> => {
  try {
    return Response.json(await operation());
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AgentLifecycleError ? error.message : "Agent lifecycle request failed",
      },
      { status: error instanceof AgentLifecycleError ? error.status : 500 },
    );
  }
};

export function createAgentLifecycleHandlers(
  integration?: AgentLifecycleIntegration,
  token: () => string | undefined = () => process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN,
) {
  const controller = new AgentLifecycleController(integration);
  const handle = (request: Request, operation: () => Promise<unknown>) => {
    const denied = authorized(request, token());
    return denied ? Promise.resolve(denied) : response(operation);
  };
  return {
    get: (request: Request) => handle(request, () => controller.get()),
    plan: (request: Request) =>
      handle(request, async () => {
        const body = await readJsonRequestWithinLimit(request, bodyLimit);
        if (!body.ok) throw new AgentLifecycleError(body.status, body.error);
        return controller.plan(body.value);
      }),
    apply: (request: Request) => handle(request, () => controller.apply()),
    revoke: (request: Request) => handle(request, () => controller.revoke()),
    recover: (request: Request) => handle(request, () => controller.recover()),
  };
}
