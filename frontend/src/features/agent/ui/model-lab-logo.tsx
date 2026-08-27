import { useState, type ComponentType } from "react";
import { Brain, Cpu, FilePenLine, Globe2, Network, Sparkles } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";

const LAB_LOGOS: Record<string, string> = {
  openai: "openai.svg",
  anthropic: "anthropic.svg",
  google: "google-color.svg",
  xai: "xai.svg",
  deepseek: "deepseek-color.svg",
  qwen: "qwen-color.svg",
  mistral: "mistral-color.svg",
  moonshot: "moonshot.svg",
  zai: "zhipu-color.svg",
  minimax: "minimax-color.svg",
  meta: "meta-color.svg",
  nvidia: "nvidia-color.svg",
  microsoft: "microsoft-color.svg",
  cohere: "cohere-color.svg",
  liquid: "liquid.svg",
  stepfun: "stepfun-color.svg",
  amazon: "aws-color.svg",
  bytedance: "bytedance-color.svg",
  tencent: "tencent-color.svg",
  arcee: "arcee-color.svg",
  allenai: "ai2-color.svg",
  nous: "nousresearch.svg",
  ibm: "ibm.svg",
  baidu: "baidu-color.svg",
  poolside: "poolside-color.svg",
  relace: "relace.svg",
  xiaomi: "xiaomimimo.svg",
  inception: "inception.svg",
  upstage: "upstage-color.svg",
  aion: "aionlabs-color.svg",
  morph: "morph-color.svg",
};

const FALLBACK_LOGOS: Record<
  string,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  thinkingmachines: Brain,
  meituan: Sparkles,
  inclusion: Network,
  sakana: Sparkles,
  nex: Sparkles,
  writer: FilePenLine,
  local: Cpu,
  other: Globe2,
};

const LOGO_ROOT = "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.94.0/icons";

export function ModelLabLogo({ lab }: { lab: string }) {
  const [failed, setFailed] = useState(false);
  const logo = LAB_LOGOS[lab];
  const Fallback = FALLBACK_LOGOS[lab] ?? Sparkles;
  if (!logo || failed) return <Fallback className="h-5 w-5" strokeWidth={1.7} />;
  return (
    <img
      src={`${LOGO_ROOT}/${logo}`}
      alt=""
      className={cx(
        "h-[22px] w-[22px] object-contain",
        !logo.includes("-color") && "[filter:var(--model-lab-logo-mono-filter)]",
      )}
      onError={() => setFailed(true)}
    />
  );
}
