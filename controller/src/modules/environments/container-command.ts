import type { Recipe } from "../models/types";
import { buildDockerRunArguments } from "../engines/process/backend-builder";
import type { EnvironmentEngineId } from "./types";

/** vLLM's official image ENTRYPOINT is already `["vllm", "serve"]`, so the
 * container command is just the engine args. */
const vllmInnerCommand = (recipe: Recipe): string[] => {
  const args = ["--model", recipe.model_path, "--host", recipe.host, "--port", String(recipe.port)];
  if (recipe.served_model_name) args.push("--served-model-name", recipe.served_model_name);
  return args;
};

/** SGLang's official image has no fixed server entrypoint — the launch
 * module must be named explicitly. */
const sglangInnerCommand = (recipe: Recipe): string[] => {
  const args = [
    "python3",
    "-m",
    "sglang.launch_server",
    "--model-path",
    recipe.model_path,
    "--host",
    recipe.host,
    "--port",
    String(recipe.port),
  ];
  if (recipe.served_model_name) args.push("--served-model-name", recipe.served_model_name);
  return args;
};

/** llama.cpp's "server" image variants already run `llama-server` as their
 * entrypoint, so the container command is just its flags. */
const llamacppInnerCommand = (recipe: Recipe): string[] => [
  "-m",
  recipe.model_path,
  "--host",
  recipe.host,
  "--port",
  String(recipe.port),
];

const INNER_COMMAND_BUILDERS: Record<EnvironmentEngineId, (recipe: Recipe) => string[]> = {
  vllm: vllmInnerCommand,
  sglang: sglangInnerCommand,
  llamacpp: llamacppInnerCommand,
};

export const buildEnvironmentContainerCommand = (
  engineId: EnvironmentEngineId,
  recipe: Recipe,
  image: string,
): string[] =>
  buildDockerRunArguments({ recipe, image, inner: INNER_COMMAND_BUILDERS[engineId](recipe) });
