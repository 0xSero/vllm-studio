import type { Recipe } from "../models/types";
import { buildDockerRunArguments, sanitizeDockerName } from "../engines/process/backend-builder";
import { buildVllmRecipeArguments } from "../engines/specs/vllm-spec";
import { buildSglangRecipeArguments } from "../engines/specs/sglang-spec";
import { buildLlamacppRecipeArguments } from "../engines/specs/llamacpp-spec";
import type { EnvironmentEngineId } from "./types";

/** An environment's container is keyed by its own id, not the recipe's — the
 * same recipe can back multiple environments (different engines/versions). */
export const environmentContainerName = (environmentId: string): string =>
  `local-studio-env-${sanitizeDockerName(environmentId)}`;

/** vLLM's official image ENTRYPOINT is `["vllm", "serve"]`; the model path is
 * its positional argument, followed by the full recipe flag set. */
const vllmInnerCommand = (recipe: Recipe): string[] => [
  recipe.model_path,
  ...buildVllmRecipeArguments(recipe),
];

/** SGLang's official image has no server entrypoint — the launch module must
 * be named explicitly. */
const sglangInnerCommand = (recipe: Recipe): string[] => [
  "python3",
  "-m",
  "sglang.launch_server",
  ...buildSglangRecipeArguments(recipe),
];

/** llama.cpp's "server" image variants run `llama-server` as their
 * entrypoint, so the container command is just its flags. */
const llamacppInnerCommand = (recipe: Recipe): string[] => buildLlamacppRecipeArguments(recipe);

const INNER_COMMAND_BUILDERS: Record<EnvironmentEngineId, (recipe: Recipe) => string[]> = {
  vllm: vllmInnerCommand,
  sglang: sglangInnerCommand,
  llamacpp: llamacppInnerCommand,
};

export const buildEnvironmentContainerCommand = (
  engineId: EnvironmentEngineId,
  recipe: Recipe,
  image: string,
  environmentId: string,
): string[] =>
  buildDockerRunArguments({
    recipe,
    image,
    inner: INNER_COMMAND_BUILDERS[engineId](recipe),
    containerName: environmentContainerName(environmentId),
  });
