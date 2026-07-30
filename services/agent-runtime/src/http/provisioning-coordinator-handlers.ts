import { timingSafeEqual } from "node:crypto";
import { readJsonRequestWithinLimit } from "../../../../shared/agent/agent-turn-body";
import {
  ProvisioningCoordinator,
  ProvisioningCoordinatorError,
  unavailableProvisioningParticipants,
  type ProvisioningParticipants,
} from "../provisioning-coordinator-service";

const authorize = (request: Request, expected: string | undefined): Response | null => {
  if (!expected) {
    return Response.json(
      { error: "Provisioning coordinator API is not configured" },
      { status: 503 },
    );
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
          error instanceof ProvisioningCoordinatorError
            ? error.message
            : "Provisioning coordinator request failed",
      },
      { status: error instanceof ProvisioningCoordinatorError ? error.status : 500 },
    );
  }
};

export const createProvisioningCoordinatorHandlers = (
  participants: ProvisioningParticipants = unavailableProvisioningParticipants(),
  token: () => string | undefined = () =>
    process.env.LOCAL_STUDIO_PROVISIONING_TOKEN ?? process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN,
  dataDirectory?: string,
) => {
  const coordinator = new ProvisioningCoordinator(participants, dataDirectory);
  const handle = (request: Request, operation: () => Promise<unknown>) => {
    const denied = authorize(request, token());
    return denied ? Promise.resolve(denied) : respond(operation);
  };
  return {
    get: (request: Request) => handle(request, () => coordinator.get()),
    setup: (request: Request) =>
      handle(request, async () => {
        const body = await readJsonRequestWithinLimit(request, 1024 * 1024);
        if (!body.ok) throw new ProvisioningCoordinatorError(body.status, body.error);
        return coordinator.setup(body.value);
      }),
    reconcile: (request: Request) => handle(request, () => coordinator.reconcile()),
    offboard: (request: Request) => handle(request, () => coordinator.offboard()),
    recover: (request: Request) => handle(request, () => coordinator.recover()),
  };
};
