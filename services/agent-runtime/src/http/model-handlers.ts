import { Option, Schema } from "effect";
import {
  refreshPiModels,
  type PiControllerModelsRequest,
} from "../pi-runtime-models";
import { errorMessage, jsonError } from "./helpers";

const ControllerCandidateSchema = Schema.Struct({
  url: Schema.Unknown,
  apiKey: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.Unknown),
});

const ControllerCandidatesSchema = Schema.Array(Schema.Unknown);
const AgentModelsRequestSchema = Schema.Struct({
  controllers: Schema.optional(ControllerCandidatesSchema),
});

type ControllerCandidates = typeof ControllerCandidatesSchema.Type;

const decodeControllerCandidate = Schema.decodeUnknownOption(ControllerCandidateSchema);
const decodeString = Schema.decodeUnknownOption(Schema.String);

function parseControllers(candidates: ControllerCandidates): PiControllerModelsRequest[] {
  return candidates.flatMap((entry) => {
    const candidate = Option.getOrNull(decodeControllerCandidate(entry));
    if (!candidate) return [];
    const url = Option.getOrNull(decodeString(candidate.url));
    if (!url?.trim()) return [];
    const controller: PiControllerModelsRequest = { url };
    const apiKey = Option.getOrNull(decodeString(candidate.apiKey));
    const name = Option.getOrNull(decodeString(candidate.name));
    if (apiKey !== null) controller.apiKey = apiKey;
    if (name !== null) controller.name = name;
    return [controller];
  });
}

export async function handleAgentModels(request?: Request): Promise<Response> {
  try {
    const rawBody = request ? await request.json().catch(() => ({})) : {};
    const body = Option.getOrNull(Schema.decodeUnknownOption(AgentModelsRequestSchema)(rawBody));
    const { models } = await refreshPiModels(parseControllers(body?.controllers ?? []));
    return Response.json({ provider: "local-studio", models });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to load /v1/models"), 502);
  }
}
